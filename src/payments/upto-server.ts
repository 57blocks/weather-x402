import type {
  Network,
  PaymentRequirements,
  SchemeNetworkServer,
  SupportedKind,
} from '@x402/core/types';
import { ExactStellarScheme as ExactServerScheme } from '@x402/stellar/exact/server';

/** Resource Server adapter for AgentSmith's experimental Stellar upto scheme. */
export class UptoStellarServer implements SchemeNetworkServer {
  readonly scheme = 'upto';
  readonly defaultAssetTransferMethod = 'default';
  readonly paymentFlows = {
    default: { supported: ['authorization'] as const, default: 'authorization' as const },
  };
  private readonly delegate = new ExactServerScheme();

  parsePrice = this.delegate.parsePrice.bind(this.delegate);
  getAssetDecimals = this.delegate.getAssetDecimals.bind(this.delegate);
  enhancePaymentRequirements = async (
    requirements: PaymentRequirements,
    supported: SupportedKind,
    extensions: string[],
  ) => this.delegate.enhancePaymentRequirements(requirements, supported, extensions);
  getExtra = (_network: Network) => ({ areFeesSponsored: true });
}
