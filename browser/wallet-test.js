/**
 * Browser entry for the Freighter wallet test harness.
 *
 * Bundled by `npm run build:browser` into public/wallet-test.bundle.js. It is
 * bundled rather than loaded from a CDN on purpose: esm.sh's CJS->ESM shim
 * mis-resolves bignumber.js's default export inside @stellar/stellar-sdk
 * ("Ro.clone is not a function" at module-init time, which kills the whole
 * module before any listener is attached). Bundling from local node_modules
 * also guarantees the page signs with exactly the @x402/stellar version the
 * server verifies with.
 */
import {
  isConnected,
} from '@stellar/freighter-api';
import { createFreighterSigner } from './freighter-signer.js';
import { payForResource } from './x402-payment.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const statusEl = $('status');
const resultEl = $('result');
const paymentEl = $('payment');
const weatherSummaryEl = $('weatherSummary');

function log(message, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

let signer;

function renderPayment(requirements, settlement) {
  if (!requirements) {
    paymentEl.textContent = '—';
    return;
  }
  const upto = requirements.scheme === 'upto';
  paymentEl.textContent = JSON.stringify({
    scheme: requirements.scheme,
    network: requirements.network,
    asset: requirements.asset,
    payTo: requirements.payTo,
    ...(upto ? {
      maximumAmountAtomic: requirements.amount,
      actualAmountAtomic: settlement?.amount || 'pending',
      settlementContract: requirements.extra?.settlementContract,
      facilitator: requirements.extra?.facilitator,
    } : {
      amountAtomic: requirements.amount,
    }),
    ...(settlement?.transaction ? { transaction: settlement.transaction } : {}),
  }, null, 2);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metric(label, value) {
  const node = element('div', 'metric');
  node.append(element('span', 'metric-label', label), element('span', 'metric-value', value));
  return node;
}

function observedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return `${date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })} UTC`;
}

function weatherSentence(station) {
  const temperature = Number.isFinite(station.temperatureC) ? `${station.temperatureC}°C` : 'unavailable';
  const windDirection = station.windDirection === 'VRB' ? 'variable' : station.windDirection;
  const wind = windDirection && Number.isFinite(station.windSpeedKt)
    ? `${windDirection} winds at ${station.windSpeedKt} kt`
    : 'no reported wind reading';
  const visibility = station.visibility ? ` Visibility is ${station.visibility} miles.` : '';
  const conditions = station.flightCategory ? ` Flight conditions are ${station.flightCategory}.` : '';
  return `Today's latest observation reports a temperature of ${temperature}, with ${wind}.${visibility}${conditions}`;
}

function renderWeather(body) {
  weatherSummaryEl.replaceChildren();
  const stations = Array.isArray(body?.data?.stations) ? body.data.stations : [];
  if (stations.length === 0) {
    weatherSummaryEl.hidden = true;
    return;
  }

  for (const station of stations) {
    const card = element('article', 'weather-card');
    const head = element('div', 'weather-card-head');
    head.append(
      element('h3', 'station', station.icaoId || 'Weather station'),
      element('p', 'station-name', station.name || 'Current METAR observation'),
      element('p', 'weather-sentence', weatherSentence(station)),
    );
    const metrics = element('div', 'metrics');
    metrics.append(
      metric('Temperature', Number.isFinite(station.temperatureC) ? `${station.temperatureC} °C` : '—'),
      metric('Flight category', station.flightCategory || '—'),
      metric('Wind', Number.isFinite(station.windSpeedKt)
        ? `${station.windDirection || '—'} · ${station.windSpeedKt} kt`
        : '—'),
      metric('Observed', observedAt(station.observedAt)),
    );
    card.append(head, metrics);
    weatherSummaryEl.append(card);
  }
  weatherSummaryEl.hidden = false;
}

$('connect').addEventListener('click', async () => {
  const connectButton = $('connect');
  connectButton.disabled = true;
  try {
    log('Checking for the Freighter extension…');
    const connection = await isConnected();
    if (connection.error) throw new Error(`isConnected: ${connection.error.message || connection.error}`);
    if (!connection.isConnected) {
      statusEl.textContent = 'Freighter not detected.';
      log('Freighter is not installed / not detected in this browser.', 'err');
      return;
    }

    log('Requesting access — approve the Freighter popup…');
    const connected = await createFreighterSigner();
    signer = connected.signer;
    log(`Freighter network: ${connected.network.network} (${connected.network.networkPassphrase})`);
    statusEl.textContent = `Connected: ${signer.address}`;
    statusEl.classList.add('connected');
    connectButton.textContent = '✓ Freighter connected';
    connectButton.classList.add('connected');
    log(`Connected as ${signer.address}`, 'ok');
    $('run').disabled = false;
  } catch (err) {
    statusEl.textContent = 'Connection failed — see log.';
    log(`Connect failed: ${err.message || err}`, 'err');
  } finally {
    if (!signer) connectButton.disabled = false;
  }
});

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  resultEl.textContent = '—';
  weatherSummaryEl.hidden = true;
  weatherSummaryEl.replaceChildren();
  renderPayment();
  const baseUrl = $('baseUrl').value.replace(/\/$/, '');
  const icao = $('icao').value.trim();
  const url = `${baseUrl}/v1/metar`;
  let requirements;

  try {
    log(`POST ${url} { icao: "${icao}" } (no payment)`);
    const payment = await payForResource({
      url,
      request: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ icao }),
      },
      scheme: $('scheme').value,
      signer,
      rpcUrl: $('rpcUrl').value.trim(),
      onEvent(event, detail) {
        if (event === 'payment-required') {
          log('402 Payment Required — decoded PAYMENT-REQUIRED.');
          requirements = detail.requirements;
          log(`Selected ${requirements.scheme}: ${requirements.network}, ${requirements.amount} of ${requirements.asset} -> ${requirements.payTo}`);
          renderPayment(requirements);
          if (!signer) throw new Error('Connect Freighter first (step 1)');
        } else if (event === 'signing') {
          if (requirements.scheme === 'upto') {
            log(`Building Kernel authorization for up to ${requirements.amount} atomic units, then asking Freighter to sign…`);
          } else {
            log('Building and simulating the exact transfer, then asking Freighter to sign the auth entry…');
          }
        } else if (event === 'signed') {
          log('Signed. Retrying with PAYMENT-SIGNATURE…', 'ok');
        }
      },
    });
    const response = payment.response;
    if (!payment.paymentRequired) {
      log('No 402 — the server is running with x402 disabled.');
    }

    const body = await response.json();
    if (!response.ok) {
      log(`Final status ${response.status}`, 'err');
      resultEl.textContent = JSON.stringify(body, null, 2);
      return;
    }
    log(`Final status ${response.status}`, 'ok');
    renderWeather(body);

    if (payment.settlement) {
      log(`Settled: ${JSON.stringify(payment.settlement)}`, 'ok');
      if (requirements) renderPayment(requirements, payment.settlement);
      if (payment.settlement.transaction) {
        log(`https://stellar.expert/explorer/testnet/tx/${payment.settlement.transaction}`, 'ok');
      }
    }
    resultEl.textContent = JSON.stringify(body, null, 2);
  } catch (err) {
    log(`Failed: ${err.message || err}`, 'err');
    resultEl.textContent = String(err.stack || err);
  } finally {
    $('run').disabled = false;
  }
});

log('Ready. Connect Freighter to begin.');
