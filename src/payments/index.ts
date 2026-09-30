import type { RequestHandler } from 'express';
import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import { UptoStellarServer } from './upto-server.js';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { example, inputSchema, outputExample, outputSchema } from '../metar.js';

// Circle's USDC Soroban Asset Contract id, per network. USDC uses seven
// decimal places on Stellar; amounts below are therefore atomic units.
const USDC_ASSET: Record<string, string> = {
  'stellar:testnet': 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  'stellar:pubnet': 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
};

const RESOURCE_PATH = '/v1/metar';

export interface PaymentConfig {
  enabled: boolean;
  payTo?: string;
  network: `${string}:${string}`;
  facilitatorUrl: string;
  facilitatorApiKey?: string;
  facilitatorTimeoutMs: number;
  serviceBaseUrl: string;
  /** One route, priced in USDC atomic units (seven decimals). */
  usdcAmountAtomic: string;
  scheme: 'exact' | 'upto' | 'both';
  uptoKernelContract?: string;
  facilitatorAddress?: string;
}

export function paymentConfigFromEnv(
  enabled = process.env.X402_ENABLED === 'true',
): PaymentConfig {
  const network = process.env.X402_NETWORK || 'stellar:testnet';
  if (!/^[a-z0-9-]+:[A-Za-z0-9-]+$/.test(network)) {
    throw new Error('X402_NETWORK must be a CAIP-2 identifier such as stellar:testnet');
  }
  if (network.split(':', 1)[0] !== 'stellar') {
    throw new Error('X402_NETWORK must be a stellar:* network — this service only speaks the Stellar exact scheme or upto scheme');
  }

  const facilitatorUrl = new URL(process.env.X402_FACILITATOR_URL || 'http://127.0.0.1:8407');
  const serviceBaseUrl = new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:8408');
  if (enabled && process.env.NODE_ENV === 'production' && serviceBaseUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL must use HTTPS in production');
  }
  const facilitatorTimeoutMs = Number(process.env.X402_FACILITATOR_TIMEOUT_MS || 45_000);
  if (!Number.isSafeInteger(facilitatorTimeoutMs) || facilitatorTimeoutMs <= 0) {
    throw new Error('X402_FACILITATOR_TIMEOUT_MS must be a positive integer');
  }
  const usdcAmountAtomic = process.env.X402_USDC_AMOUNT_ATOMIC?.trim() || '40000';
  if (!/^[1-9][0-9]*$/.test(usdcAmountAtomic)) {
    throw new Error('X402_USDC_AMOUNT_ATOMIC must be a positive integer (USDC atomic units)');
  }

  const scheme = process.env.X402_SCHEME?.trim() || 'exact';
  if (!['exact', 'upto', 'both'].includes(scheme)) {
    throw new Error('X402_SCHEME must be exact, upto, or both');
  }

  return {
    enabled,
    payTo: process.env.X402_PAY_TO,
    network: network as `${string}:${string}`,
    facilitatorUrl: facilitatorUrl.toString().replace(/\/$/, ''),
    facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY?.trim() || undefined,
    facilitatorTimeoutMs,
    serviceBaseUrl: serviceBaseUrl.toString().replace(/\/$/, ''),
    usdcAmountAtomic,
    scheme: scheme as PaymentConfig['scheme'],
    uptoKernelContract: process.env.X402_UPTO_KERNEL_CONTRACT?.trim() || undefined,
    facilitatorAddress: process.env.X402_FACILITATOR_ADDRESS?.trim() || undefined,
  };
}

export function usdcAsset(network: string): string {
  const asset = USDC_ASSET[network];
  if (!asset) throw new Error(`No known USDC asset contract for ${network}`);
  return asset;
}

export function configuredSchemes(config: PaymentConfig): Array<'exact' | 'upto'> {
  return config.scheme === 'both' ? ['exact', 'upto'] : [config.scheme];
}

export function paymentOptions(config: PaymentConfig) {
  return configuredSchemes(config).map(scheme => ({
    scheme,
    price: { asset: usdcAsset(config.network), amount: config.usdcAmountAtomic },
    network: config.network,
    payTo: config.payTo!,
    extra: scheme === 'upto'
      ? { settlementContract: config.uptoKernelContract, facilitator: config.facilitatorAddress }
      : undefined,
  }));
}

export function createResourceServer(config: PaymentConfig) {
  const authHeaders = config.facilitatorApiKey
    ? async () => {
      const headers = { Authorization: `Bearer ${config.facilitatorApiKey}` };
      return { verify: headers, settle: headers, supported: headers };
    }
    : undefined;
  const facilitator = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    timeoutMs: config.facilitatorTimeoutMs,
    createAuthHeaders: authHeaders,
  });
  const server = new x402ResourceServer(facilitator).register(config.network, new ExactStellarScheme());
  if (configuredSchemes(config).includes('upto')) server.register(config.network, new UptoStellarServer());
  return server;
}

export type PaymentResourceServer = ReturnType<typeof createResourceServer>;

/**
 * The upto settlement contract and the facilitator's signing address are facts the
 * Facilitator owns and already advertises on /supported. Read them from there so a
 * redeployed Kernel or rotated signer stays in sync instead of drifting from a value
 * copied into this service's config. An explicit env value still wins as an override.
 */
async function deriveUptoTerms(config: PaymentConfig): Promise<void> {
  if (!configuredSchemes(config).includes('upto')) return;
  if (config.uptoKernelContract && config.facilitatorAddress) return;

  type Supported = {
    kinds?: Array<{ scheme?: string; network?: string; extra?: Record<string, unknown> }>;
    signers?: Record<string, string[]>;
  };
  let supported: Supported | undefined;
  try {
    const response = await fetch(`${config.facilitatorUrl}/supported`, {
      signal: AbortSignal.timeout(config.facilitatorTimeoutMs),
    });
    if (response.ok) supported = await response.json() as Supported;
  } catch {
    // Leave the fields unset; the caller reports the Facilitator as unusable for upto.
  }

  const uptoKind = supported?.kinds?.find(kind => kind.scheme === 'upto' && kind.network === config.network);
  const settlementContract = uptoKind?.extra?.settlementContract;
  const signers = supported?.signers ?? {};
  const family = Object.keys(signers).find(key => config.network.startsWith(key.replace(/\*$/, '')));

  config.uptoKernelContract ??= typeof settlementContract === 'string' ? settlementContract : undefined;
  config.facilitatorAddress ??= (family ? signers[family]?.[0] : undefined) ?? Object.values(signers).flat()[0];
}

export async function assertFacilitatorReady(
  config: PaymentConfig,
  resourceServer?: PaymentResourceServer,
): Promise<void> {
  if (!config.enabled) return;
  if (!config.payTo) throw new Error('X402_PAY_TO is required when X402_ENABLED=true');
  await deriveUptoTerms(config);
  if (configuredSchemes(config).includes('upto') && (!config.uptoKernelContract || !config.facilitatorAddress)) {
    throw new Error(`Facilitator at ${config.facilitatorUrl} does not advertise an upto settlement contract and signer for ${config.network}; it cannot serve the upto scheme`);
  }

  try {
    await (resourceServer || createResourceServer(config)).initialize();
  } catch (cause) {
    throw new Error(
      `x402 Facilitator readiness check failed at ${config.facilitatorUrl}/supported; verify X402_FACILITATOR_URL, X402_FACILITATOR_API_KEY, and X402_NETWORK`,
      { cause },
    );
  }
}

function resultEnvelope() {
  return {
    data: outputExample,
    meta: { service: 'weather.metar', requestId: '00000000-0000-4000-8000-000000000000', timestamp: '2026-01-01T00:00:00.000Z' },
  };
}

export function createPaymentMiddleware(
  config: PaymentConfig,
  resourceServer?: PaymentResourceServer,
): RequestHandler | undefined {
  if (!config.enabled) return undefined;
  if (!config.payTo) throw new Error('X402_PAY_TO is required when X402_ENABLED=true');

  const routes = {
    [`POST ${RESOURCE_PATH}`]: {
      accepts: paymentOptions(config),
      description: 'Current METAR weather report for one or more ICAO airport codes.',
      mimeType: 'application/json',
      resource: `${config.serviceBaseUrl}${RESOURCE_PATH}`,
      extensions: declareDiscoveryExtension({
        bodyType: 'json',
        input: example,
        inputSchema,
        output: { example: resultEnvelope(), schema: { type: 'object', properties: { data: outputSchema, meta: { type: 'object' } }, required: ['data', 'meta'] } },
      }),
    },
  };

  return paymentMiddleware(routes as never, resourceServer || createResourceServer(config));
}
