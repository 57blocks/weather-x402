import { authorizeEntry as stellarAuthorizeEntry, contract } from '@stellar/stellar-sdk';
import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from '@x402/core/types';
import {
  findDefaultAsset,
  getEstimatedLedgerCloseTimeSeconds,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  type ClientStellarSigner,
  type RpcConfig,
} from '@x402/stellar';

type KernelClient = {
  settle_with_approval(args: {
    terms: {
      payer: string;
      asset: string;
      pay_to: string;
      facilitator: string;
      max_amount: string;
      valid_after_ledger: number;
      deadline_ledger: number;
    };
    actual_amount: string;
  }): Promise<{
    built: { toXDR(): string; operations: Array<{ auth?: Array<unknown> }> };
    needsNonInvokerSigningBy(options?: { includeAlreadySigned?: boolean }): string[];
    signAuthEntries(args: {
      address: string;
      signAuthEntry?: ClientStellarSigner['signAuthEntry'];
      authorizeEntry?: typeof stellarAuthorizeEntry;
      expiration: number;
    }): Promise<void>;
  }>;
};

export type UptoStellarSigner = {
  address: string;
  signAuthEntry?: ClientStellarSigner['signAuthEntry'];
  authorizeEntry?: typeof stellarAuthorizeEntry;
};

export class UptoStellarClient implements SchemeNetworkClient {
  readonly scheme = 'upto';
  readonly findDefaultAsset = findDefaultAsset;
  private readonly signer: UptoStellarSigner;
  private readonly rpcConfig?: RpcConfig;

  constructor(signer: UptoStellarSigner, rpcConfig?: RpcConfig) {
    if (!signer.signAuthEntry && !signer.authorizeEntry) {
      throw new Error('upto signer must provide signAuthEntry or authorizeEntry');
    }
    this.signer = signer;
    this.rpcConfig = rpcConfig;
  }

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
    if (x402Version !== 2 || requirements.scheme !== 'upto') {
      throw new Error('Unsupported upto payment requirements');
    }
    if (!/^[1-9][0-9]*$/.test(requirements.amount)) {
      throw new Error('upto amount must be a positive atomic integer');
    }
    const extra = requirements.extra || {};
    if (typeof extra.settlementContract !== 'string' || typeof extra.facilitator !== 'string') {
      throw new Error('upto requirements must include settlementContract and facilitator in extra');
    }

    const networkPassphrase = getNetworkPassphrase(requirements.network);
    const rpcUrl = getRpcUrl(requirements.network, this.rpcConfig);
    const rpc = getRpcClient(requirements.network, this.rpcConfig);
    const ledger = await rpc.getLatestLedger();
    const ledgerSeconds = await getEstimatedLedgerCloseTimeSeconds(requirements.network);
    const liveUntil = ledger.sequence
      + Math.ceil((requirements.maxTimeoutSeconds ?? 60) / ledgerSeconds);
    const client = await contract.Client.from<KernelClient>({
      contractId: extra.settlementContract,
      rpcUrl,
      networkPassphrase,
      // The Facilitator sources the envelope; the Buyer signs only the Kernel authorization.
      publicKey: extra.facilitator,
    });
    const tx = await client.settle_with_approval({
      terms: {
        payer: this.signer.address,
        asset: requirements.asset,
        pay_to: requirements.payTo,
        facilitator: extra.facilitator,
        max_amount: requirements.amount,
        valid_after_ledger: ledger.sequence,
        deadline_ledger: liveUntil,
      },
      actual_amount: requirements.amount,
    });
    const missing = tx.needsNonInvokerSigningBy({ includeAlreadySigned: true });
    if (!missing.includes(this.signer.address)) {
      throw new Error(
        `upto transaction did not request buyer authorization (needs: ${missing.join(', ') || 'none'})`,
      );
    }
    await tx.signAuthEntries({
      address: this.signer.address,
      signAuthEntry: this.signer.signAuthEntry,
      authorizeEntry: this.signer.authorizeEntry,
      expiration: liveUntil,
    });
    return { x402Version, payload: { transaction: tx.built.toXDR() } };
  }
}
