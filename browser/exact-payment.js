import { ExactStellarScheme } from '@x402/stellar/exact/client';

/** Creates the official x402 Stellar exact Buyer implementation. */
export function createExactPaymentScheme(signer, rpcUrl) {
  return new ExactStellarScheme(signer, { url: rpcUrl });
}
