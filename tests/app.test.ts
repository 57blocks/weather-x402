import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const SAMPLE = [{
  icaoId: 'ZUUU', reportTime: '2026-08-25T08:00:00.000Z', temp: 36, dewp: 23,
  wdir: 'VRB', wspd: 2, visib: '6+', altim: 1003,
  rawOb: 'METAR ZUUU 250800Z VRB01MPS 9999 FEW026TCU FEW026 36/23 Q1003 NOSIG',
  lat: 30.576, lon: 103.95, elev: 494, name: 'Chengdu/Shuangliu Intl, CQ, CN',
  clouds: [{ cover: 'FEW', base: 2600 }], fltCat: 'VFR',
}];

describe('HTTP API', () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(SAMPLE), { status: 200 }));
  const app = createApp({ fetcher, x402Enabled: false });

  it('advertises health and OpenAPI', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, service: 'weather-metar', x402: false });
    const openapi = await request(app).get('/openapi.json');
    expect(openapi.body.paths['/v1/metar']).toBeDefined();
  });

  it('looks up METAR through REST', async () => {
    const response = await request(app).post('/v1/metar').send({ icao: 'ZUUU' });
    expect(response.status).toBe(200);
    expect(response.body.data.stations[0].icaoId).toBe('ZUUU');
    expect(response.body.meta.service).toBe('weather.metar');
  });

  it('serves the wallet-test harness page, unpaid', async () => {
    const response = await request(app).get('/wallet-test.html');
    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('Freighter');
    expect(response.text).toContain('Kernel-backed <strong>upto</strong>');
    expect(response.text).toContain('Payment scheme');
    expect(response.text).toContain('Weather API response');
    expect(response.text).toContain('Raw Weather API JSON');
  });

  it('rejects a malformed ICAO id with 400', async () => {
    const response = await request(app).post('/v1/metar').send({ icao: '???' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 404 when nothing is found', async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const response = await request(app).post('/v1/metar').send({ icao: 'ZZZZ' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('STATION_NOT_FOUND');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const response = await request(app).post('/v1/metar').set('content-type', 'application/json').send('{bad');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('returns a 404 envelope for unknown routes', async () => {
    const response = await request(app).get('/nope');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
