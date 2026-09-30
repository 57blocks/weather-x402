import 'dotenv/config';
import { createApp } from './app.js';
import { assertFacilitatorReady, createResourceServer, paymentConfigFromEnv } from './payments/index.js';

const port = Number(process.env.PORT || 8408);
const host = process.env.HOST || '0.0.0.0';
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10_000);
const paymentConfig = paymentConfigFromEnv();
const paymentResourceServer = paymentConfig.enabled
  ? createResourceServer(paymentConfig)
  : undefined;
await assertFacilitatorReady(paymentConfig, paymentResourceServer);
const app = createApp({ paymentConfig, paymentResourceServer });
const server = app.listen(port, host, () => {
  console.log(`weather-metar listening on http://${host}:${port}`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; draining connections`);
  const timer = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, shutdownTimeoutMs);
  timer.unref();
  server.close((error) => {
    clearTimeout(timer);
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
