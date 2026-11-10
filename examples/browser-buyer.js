import { createVarialSigner } from '../browser/varial-signer.js';
import { payForResource } from '../browser/x402-payment.js';

/** This is the same exact flow used by public/wallet-test.html. */
export async function payExactWithVarial({ url, request, rpcUrl }) {
  const { signer } = await createVarialSigner();
  return payForResource({
    url,
    request,
    scheme: 'exact',
    signer,
    rpcUrl,
  });
}
