# weather-x402 — AgentSmith Facilitator demo

A self-contained integration demo for the **AgentSmith Stellar Facilitator**. It shows
both sides of a real x402-gated resource request so you can read them independently:

- **Seller** — a real REST weather service that answers `402 Payment Required`,
  then asks the **AgentSmith Facilitator** to verify and settle the payment.
- **Buyer** — a browser page that connects a **Freighter wallet**, signs the Soroban
  authorization locally, and retries the call. A reusable browser integration example
  is included too.

The one capability is a current METAR (aviation weather) lookup by ICAO code, priced in
**Stellar testnet USDC**. Payment is real: `/verify` and `/settle` run against a live
AgentSmith Facilitator on Stellar testnet, not a stub that accepts any header. The demo
covers both standard `exact` payments and AgentSmith's Kernel-backed `upto` scheme.

The integration boundary is HTTP: this repo does not import code from the AgentSmith
Facilitator. It connects to the hosted service through `X402_FACILITATOR_URL`.

## AgentSmith Facilitator

- **Facilitator URL:** <https://agentsmith.xyz/facilitator>
- **Documentation:** [AgentSmith Facilitator Quickstart](https://agentsmith.xyz/docs.html#quickstart)

## What you need

- Node.js >= 22
- Access to the AgentSmith Facilitator (`https://agentsmith.xyz/facilitator`)
- A Freighter wallet (browser extension) switched to **Testnet** — the Buyer signs with it
- Testnet USDC in the buyer wallet, from the Circle faucet (below)

The AgentSmith Facilitator sponsors the XLM network fee for every settlement, so the
buyer needs **USDC only**. (A wallet needs a little XLM once, to create the USDC
trustline.)

## Track 1 — Run the Seller

```bash
npm install
cp .env.example .env      # then edit: set X402_PAY_TO
npm run build             # compiles TS + bundles the browser buyer page
npm run dev               # http://127.0.0.1:8408
```

The example configuration is already pointed at the hosted **AgentSmith Facilitator**:

```dotenv
X402_FACILITATOR_URL=https://agentsmith.xyz/facilitator
```

On startup the service calls the AgentSmith Facilitator's `/supported` endpoint, learns
its `exact` and `upto` capabilities, and refuses to listen if readiness fails.

```bash
curl -i -X POST http://127.0.0.1:8408/v1/metar \
  -H 'content-type: application/json' -d '{"icao":"KJFK"}'
# => 402, with a base64 PAYMENT-REQUIRED header listing exact and upto
```

Seller integration to read:

- `examples/resource-server.ts` — minimal Seller-to-Facilitator connection for `exact`.
- `src/payments/index.ts` — payment configuration, Facilitator client, scheme registration,
  and the Express payment middleware.
- `src/payments/upto-server.ts` — the `upto` scheme isolated by trust boundary.

## Track 2 — Pay as a Buyer (Freighter wallet)

1. Get testnet USDC into Freighter. USDC on Stellar testnet is Circle's asset:
   issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, code `USDC`.
   In Freighter (Testnet) add a USDC trustline to that issuer, then fund the address at
   <https://faucet.circle.com> (Stellar -> Testnet).
2. Open `http://127.0.0.1:8408/wallet-test.html`.
3. Connect Freighter, set Base URL to `http://127.0.0.1:8408`, choose a scheme
   (`exact` or `upto`), enter an ICAO code, and Run. Freighter pops up to sign.
4. On success the page renders the weather and shows the settlement transaction URL on
   stellar.expert (testnet) — the transaction is the on-chain proof.

Buyer integration to read:

- `browser/x402-payment.js` — the reusable browser buyer flow (402 -> sign -> retry).
- `browser/freighter-signer.js` — adapts Freighter to the signer interface.
- `src/payments/upto-client.ts` — the `upto` client, mirroring the server half.

The files under `browser/` are the maintainable Buyer source. `npm run build:browser`
bundles them and their npm dependencies into `public/wallet-test.bundle.js`; treat that
bundle as generated output rather than editing it directly.

## Notes

- Amounts are atomic; USDC has 7 decimals (`40000` = 0.004 USDC).
- `exact` transfers a fixed amount. `upto` signs a ceiling; the server settles the
  smaller actual amount, returned in `PAYMENT-RESPONSE`.
- `X402_ENABLED=false` disables payment entirely for plain API development.
