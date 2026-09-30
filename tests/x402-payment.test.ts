import { describe, expect, it, vi } from 'vitest';
import {
  decodeBase64Json,
  encodeBase64Json,
  payForResource,
  selectPaymentRequirements,
} from '../browser/x402-payment.js';

const requirements = {
  scheme: 'exact',
  network: 'stellar:testnet',
  asset: 'CUSDC',
  amount: '40000',
  payTo: 'GSELLER',
};

describe('browser x402 payment flow', () => {
  it('round-trips UTF-8 JSON headers', () => {
    const value = { description: '成都 weather', amount: '40000' };
    expect(decodeBase64Json(encodeBase64Json(value), 'TEST')).toEqual(value);
  });

  it('rejects a scheme the Resource Server did not advertise', () => {
    expect(() => selectPaymentRequirements({ accepts: [requirements] }, 'upto'))
      .toThrow(/does not advertise upto/);
  });

  it('reads the 402, signs locally and retries with PAYMENT-SIGNATURE', async () => {
    const paymentRequired = {
      x402Version: 2,
      resource: { url: 'https://example.test/v1/weather' },
      accepts: [requirements],
    };
    const settlement = { success: true, transaction: 'abc123', amount: '40000' };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 402,
        headers: { 'payment-required': encodeBase64Json(paymentRequired) },
      }))
      .mockResolvedValueOnce(new Response('{"ok":true}', {
        status: 200,
        headers: { 'payment-response': encodeBase64Json(settlement) },
      }));
    const createPaymentPayload = vi.fn().mockResolvedValue({
      x402Version: 2,
      payload: { transaction: 'signed-xdr' },
    });
    const events: string[] = [];

    const result = await payForResource({
      url: 'https://example.test/v1/weather',
      request: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"icao":"ZUUU"}',
      },
      scheme: 'exact',
      signer: { address: 'GBUYER' },
      rpcUrl: 'https://rpc.test',
      fetcher,
      schemeFactory: () => ({ createPaymentPayload }),
      onEvent: (event: string) => events.push(event),
    });

    expect(createPaymentPayload).toHaveBeenCalledWith(2, requirements);
    expect(events).toEqual(['payment-required', 'signing', 'signed']);
    expect(result.requirements).toEqual(requirements);
    expect(result.settlement).toEqual(settlement);

    const paidRequest = fetcher.mock.calls[1]?.[1] as RequestInit;
    const encoded = new Headers(paidRequest.headers).get('payment-signature');
    expect(encoded).toBeTruthy();
    expect(decodeBase64Json(encoded!, 'PAYMENT-SIGNATURE')).toMatchObject({
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: requirements,
      payload: { transaction: 'signed-xdr' },
    });
  });
});
