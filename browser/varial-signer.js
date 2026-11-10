import {
  getNetwork,
  requestAccess,
  signAuthEntry,
  signTransaction,
} from '@stellar/varial-sdk';

/** Connects Varial and returns the signer expected by @x402/stellar. */
export async function createVarialSigner() {
  const access = await requestAccess();
  if (access.error) {
    throw new Error(`requestAccess: ${access.error.message || access.error}`);
  }
  if (!access.address) {
    throw new Error('Varial access was not granted');
  }

  const network = await getNetwork();
  if (network.error) {
    throw new Error(`getNetwork: ${network.error.message || network.error}`);
  }
  if (!/TESTNET/i.test(network.network || '')) {
    throw new Error(`Switch Varial to Stellar Testnet (currently ${network.network})`);
  }

  return {
    signer: {
      address: access.address,
      signAuthEntry,
      signTransaction,
    },
    network,
  };
}
