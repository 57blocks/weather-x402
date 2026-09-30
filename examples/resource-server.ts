import { paymentMiddleware } from '@x402/express';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactStellarScheme } from '@x402/stellar/exact/server';

/** Connects Seller-owned route definitions to the deployed Facilitator. */
export async function createFacilitatorMiddleware(routes: unknown) {
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;
  if (!facilitatorUrl) throw new Error('X402_FACILITATOR_URL is required');

  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitator)
    .register('stellar:testnet', new ExactStellarScheme());

  await resourceServer.initialize();
  return paymentMiddleware(routes as never, resourceServer);
}
