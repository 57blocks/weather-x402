// Registers this server's REST listing into the Bazaar catalog; run post-deploy.
import 'dotenv/config';
import { example, inputSchema, outputExample, outputSchema } from '../src/metar.js';
import { configuredSchemes, paymentConfigFromEnv, usdcAsset } from '../src/payments/index.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  const value = args[index + 1];
  return index >= 0 && value && !value.startsWith('--') ? value : fallback;
};
const bazaar = flag('bazaar', process.env.BAZAAR_URL || 'http://localhost:8402').replace(/\/$/, '');
const config = paymentConfigFromEnv(false);
if (!config.payTo) {
  console.error('X402_PAY_TO is required to create a payable Bazaar listing');
  process.exit(1);
}

const SERVICE_ID = 'weather.metar';
const TITLE = 'Weather METAR';
const DESCRIPTION = 'Current METAR weather report for one or more ICAO airport codes.';
const TAGS = ['weather', 'aviation', 'metar', 'stellar', 'testnet'];

function usdcDecimal(atomic: string) {
  const padded = atomic.padStart(8, '0');
  const whole = padded.slice(0, -7);
  const fraction = padded.slice(-7).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

// Must mirror what src/payments/index.ts actually charges — the catalog price and the
// enforced price are two independent code paths, and this is where they'd drift.
function accepts() {
  return configuredSchemes(config).map(scheme => ({
    scheme,
    network: config.network,
    asset: usdcAsset(config.network),
    amount: config.usdcAmountAtomic,
    maxAmountRequired: usdcDecimal(config.usdcAmountAtomic),
    payTo: config.payTo!,
    maxTimeoutSeconds: 60,
    ...(scheme === 'upto'
      ? { extra: { settlementContract: config.uptoKernelContract, facilitator: config.facilitatorAddress } }
      : {}),
  }));
}

function restListing() {
  const path = '/v1/metar';
  return {
    resource: {
      url: `${config.serviceBaseUrl}${path}`,
      description: DESCRIPTION,
      mimeType: 'application/json',
      serviceName: TITLE,
      tags: TAGS,
    },
    info: {
      input: { type: 'http', method: 'POST', bodyType: 'json', body: example, schema: inputSchema },
      output: {
        type: 'json', format: 'application/json',
        structure: '{ data: { requested, stations }, meta: request metadata }',
        example: { data: outputExample, meta: { service: SERVICE_ID } },
        schema: { type: 'object', properties: { data: outputSchema, meta: { type: 'object' } }, required: ['data', 'meta'] },
      },
    },
    accepts: accepts(),
  };
}

const response = await fetch(`${bazaar}/discovery/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ listing: restListing(), payable: true, payable_reason: null }),
});
const body = await response.text();
if (!response.ok) {
  console.error(`[register] ${SERVICE_ID}/rest: HTTP ${response.status} ${body}`);
  process.exitCode = 1;
} else {
  console.log(`[register] ${SERVICE_ID}/rest: ${body}`);
}
