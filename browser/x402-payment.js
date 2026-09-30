import { UptoStellarClient } from '../src/payments/upto-client.ts';
import { createExactPaymentScheme } from './exact-payment.js';

/** UTF-8 safe base64 for x402's JSON HTTP headers. */
export function encodeBase64Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64Json(value, headerName) {
  try {
    const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${headerName} was not base64-encoded JSON`);
  }
}

export function readPaymentRequired(response) {
  const header = response.headers.get('payment-required');
  if (!header) {
    throw new Error('402 had no PAYMENT-REQUIRED header (Access-Control-Expose-Headers missing?)');
  }
  return decodeBase64Json(header, 'PAYMENT-REQUIRED');
}

export function selectPaymentRequirements(paymentRequired, scheme) {
  const requirements = paymentRequired.accepts?.find(option => option.scheme === scheme);
  if (!requirements) {
    const available = paymentRequired.accepts?.map(option => option.scheme).join(', ') || 'none';
    throw new Error(`Server does not advertise ${scheme}; available schemes: ${available}`);
  }
  return requirements;
}

export function createPaymentScheme(requirements, signer, rpcUrl) {
  const rpcConfig = { url: rpcUrl };
  if (requirements.scheme === 'exact') {
    return createExactPaymentScheme(signer, rpcUrl);
  }
  if (requirements.scheme === 'upto') {
    return new UptoStellarClient({
      address: signer.address,
      signAuthEntry: signer.signAuthEntry,
    }, rpcConfig);
  }
  throw new Error(`Unsupported payment scheme: ${requirements.scheme}`);
}

export function readSettlement(response) {
  const header = response.headers.get('payment-response')
    || response.headers.get('x-payment-response');
  return header ? decodeBase64Json(header, 'PAYMENT-RESPONSE') : undefined;
}

/**
 * Executes the complete Buyer-side x402 HTTP flow. The wallet signs locally;
 * only the signed payment payload is sent to the Resource Server.
 */
export async function payForResource({
  url,
  request,
  scheme,
  signer,
  rpcUrl,
  fetcher = fetch,
  schemeFactory = createPaymentScheme,
  onEvent = () => {},
}) {
  let response = await fetcher(url, request);
  if (response.status !== 402) {
    return { response };
  }

  const paymentRequired = readPaymentRequired(response);
  const requirements = selectPaymentRequirements(paymentRequired, scheme);
  onEvent('payment-required', { paymentRequired, requirements });

  const paymentScheme = schemeFactory(requirements, signer, rpcUrl);
  onEvent('signing', { requirements });
  const payment = await paymentScheme.createPaymentPayload(2, requirements);
  onEvent('signed', { requirements });

  const paymentPayload = {
    x402Version: payment.x402Version,
    ...(paymentRequired.resource ? { resource: paymentRequired.resource } : {}),
    accepted: requirements,
    payload: payment.payload,
  };
  const headers = new Headers(request.headers);
  headers.set('payment-signature', encodeBase64Json(paymentPayload));
  response = await fetcher(url, { ...request, headers });

  return {
    response,
    paymentRequired,
    requirements,
    settlement: readSettlement(response),
  };
}
