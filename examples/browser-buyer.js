import { createFreighterSigner } from '../browser/freighter-signer.js';
import { payForResource } from '../browser/x402-payment.js';

/** This is the same exact flow used by public/wallet-test.html. */
export async function payExactWithFreighter({ url, request, rpcUrl }) {
  const { signer } = await createFreighterSigner();
  return payForResource({
    url,
    request,
    scheme: 'exact',
    signer,
    rpcUrl,
  });
}
