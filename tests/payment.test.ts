import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { assertFacilitatorReady, createResourceServer, paymentConfigFromEnv, paymentOptions, usdcAsset } from '../src/payments/index.js';

afterEach(() => vi.unstubAllGlobals());

function withEnv(overrides: NodeJS.ProcessEnv, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  try {
    fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

describe('x402 configuration', () => {
  it('fails closed when payment is enabled without X402_PAY_TO', () => {
    expect(() => createApp({ x402Enabled: true })).toThrow(/X402_PAY_TO/);
  });

  it('keeps health and OpenAPI public regardless of payment state', async () => {
    const app = createApp({ x402Enabled: false });
    expect(app).toBeDefined();
  });

  it('rejects invalid network identifiers', () => {
    const previous = process.env.X402_NETWORK;
    process.env.X402_NETWORK = 'not-a-network';
    expect(() => createApp({ x402Enabled: false })).toThrow(/CAIP-2/);
    if (previous === undefined) delete process.env.X402_NETWORK;
    else process.env.X402_NETWORK = previous;
  });

  it('rejects a non-stellar network namespace', () => {
    withEnv({ X402_NETWORK: 'eip155:84532' }, () => {
      expect(() => paymentConfigFromEnv(false)).toThrow(/only speaks the Stellar exact scheme/);
    });
  });

  it('rejects invalid facilitator timeout values', () => {
    withEnv({ X402_FACILITATOR_TIMEOUT_MS: 'not-a-number' }, () => {
      expect(() => createApp({ x402Enabled: false })).toThrow(/FACILITATOR_TIMEOUT/);
    });
  });

  it('defaults the USDC amount to 40000 atomic units and validates overrides', () => {
    expect(paymentConfigFromEnv(false).usdcAmountAtomic).toBe('40000');
    withEnv({ X402_USDC_AMOUNT_ATOMIC: 'not-a-number' }, () => {
      expect(() => paymentConfigFromEnv(false)).toThrow(/X402_USDC_AMOUNT_ATOMIC/);
    });
  });

  it('supports advertising exact and upto together', () => {
    withEnv({ X402_SCHEME: 'both' }, () => {
      const config = {
        ...paymentConfigFromEnv(false),
        payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        uptoKernelContract: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        facilitatorAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      };
      expect(config.scheme).toBe('both');
      expect(paymentOptions(config).map(option => option.scheme)).toEqual(['exact', 'upto']);
      expect(paymentOptions(config)[1]?.extra).toMatchObject({
        settlementContract: config.uptoKernelContract,
        facilitator: config.facilitatorAddress,
      });
    });
    withEnv({ X402_SCHEME: 'unknown' }, () => {
      expect(() => paymentConfigFromEnv(false)).toThrow(/exact, upto, or both/);
    });
  });

  it('uses the canonical USDC asset for each Stellar network', () => {
    expect(usdcAsset('stellar:testnet')).toBe('CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA');
    expect(usdcAsset('stellar:pubnet')).toBe('CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75');
  });

  it('registers the Stellar exact scheme for a stellar:testnet facilitator', () => {
    const resourceServer = createResourceServer({
      enabled: true,
      payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      network: 'stellar:testnet',
      facilitatorUrl: 'http://127.0.0.1:8407',
      facilitatorTimeoutMs: 45_000,
      serviceBaseUrl: 'http://localhost:8408',
      usdcAmountAtomic: '40000',
    });
    expect(resourceServer).toBeDefined();
  });

  it('runs readiness on the Resource Server instance supplied to the app', async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    await assertFacilitatorReady({
      enabled: true,
      payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      network: 'stellar:testnet',
      facilitatorUrl: 'http://127.0.0.1:8407',
      facilitatorTimeoutMs: 45_000,
      serviceBaseUrl: 'http://localhost:8408',
      usdcAmountAtomic: '40000',
      scheme: 'exact',
    }, { initialize } as never);

    expect(initialize).toHaveBeenCalledOnce();
  });

  it('refuses startup when the Facilitator rejects the server-to-server token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )));

    await expect(assertFacilitatorReady({
      enabled: true,
      payTo: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      network: 'stellar:testnet',
      facilitatorUrl: 'http://127.0.0.1:8407',
      facilitatorApiKey: 'wrong-token',
      facilitatorTimeoutMs: 45_000,
      serviceBaseUrl: 'http://localhost:8408',
      usdcAmountAtomic: '40000',
    })).rejects.toThrow(/readiness check failed.*X402_FACILITATOR_API_KEY/);
  });
});
