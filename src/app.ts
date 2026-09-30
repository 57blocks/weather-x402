import { randomUUID } from 'node:crypto';
import path from 'node:path';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Request } from 'express';
import helmet from 'helmet';
import type { Fetcher } from './types.js';
import { example, execute, inputSchema, outputExample, outputSchema } from './metar.js';
import {
  createPaymentMiddleware,
  paymentConfigFromEnv,
  type PaymentConfig,
  type PaymentResourceServer,
} from './payments/index.js';
import { setSettlementOverrides } from '@x402/express';
import { normalizeError } from './errors.js';

export interface AppOptions {
  fetcher?: Fetcher;
  x402Enabled?: boolean;
  paymentConfig?: PaymentConfig;
  paymentResourceServer?: PaymentResourceServer;
}

function selectedPaymentScheme(req: Request): string | undefined {
  const header = req.get('payment-signature') || req.get('x-payment');
  if (!header) return undefined;
  try {
    const payment = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
      accepted?: { scheme?: unknown };
    };
    return typeof payment.accepted?.scheme === 'string' ? payment.accepted.scheme : undefined;
  } catch {
    return undefined;
  }
}

export function createApp(options: AppOptions = {}) {
  const fetcher = options.fetcher || fetch;
  const payment = options.paymentConfig || paymentConfigFromEnv(options.x402Enabled);
  if (payment.enabled && !payment.payTo) throw new Error('X402_PAY_TO is required when X402_ENABLED=true');

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*', exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'X-PAYMENT-RESPONSE'] }));
  app.use(express.json({ limit: process.env.MAX_BODY_SIZE || '256kb' }));

  // Manual joint-test harness (wallet-test.html) — static, always free, never behind payment.
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/health', (_req, res) => res.json({
    ok: true,
    service: 'weather-metar',
    version: '0.1.0',
    x402: payment.enabled,
  }));

  app.get('/openapi.json', (_req, res) => res.json({
    openapi: '3.1.0',
    info: { title: 'Weather METAR', version: '0.1.0', description: 'Real x402-gated aviation METAR lookup, settled on Stellar.' },
    servers: [{ url: payment.serviceBaseUrl }],
    paths: {
      '/v1/metar': {
        post: {
          operationId: 'weather_metar',
          summary: 'Current METAR weather report',
          description: 'Current METAR weather report for one or more ICAO airport codes.',
          requestBody: { required: true, content: { 'application/json': { schema: inputSchema, example } } },
          responses: {
            '200': { description: 'Successful lookup', content: { 'application/json': { schema: { type: 'object', properties: { data: outputSchema, meta: { type: 'object' } } }, example: { data: outputExample, meta: { service: 'weather.metar' } } } } },
            '400': { description: 'Invalid input' },
            '402': { description: 'x402 payment required' },
            '404': { description: 'No current report for the requested station(s)' },
            '502': { description: 'Upstream provider failed' },
          },
        },
      },
    },
  }));

  if (payment.enabled) app.use(createPaymentMiddleware(payment, options.paymentResourceServer)!);

  app.post('/v1/metar', async (req, res, next) => {
    try {
      const data = await execute(fetcher, req.body);
      if (selectedPaymentScheme(req) === 'upto') {
        const requested = data.requested.length;
        const actual = String(Math.min(Number(payment.usdcAmountAtomic), Math.max(1, requested) * 10_000));
        setSettlementOverrides(res, { amount: actual });
      }
      res.json({ data, meta: { service: 'weather.metar', requestId: req.get('x-request-id') || randomUUID(), timestamp: new Date().toISOString() } });
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    const e = normalizeError(err);
    res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) } });
  };
  app.use(errors);

  return app;
}
