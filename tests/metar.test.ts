import { describe, expect, it, vi } from 'vitest';
import { execute, fetchMetar, metarInput } from '../src/metar.js';
import { AppError } from '../src/errors.js';

const SAMPLE = [{
  icaoId: 'ZUUU', receiptTime: '2026-08-25T08:05:27.945Z', obsTime: 1787644800,
  reportTime: '2026-08-25T08:00:00.000Z', temp: 36, dewp: 23, wdir: 'VRB', wspd: 2,
  visib: '6+', altim: 1003, qcField: 16, metarType: 'METAR',
  rawOb: 'METAR ZUUU 250800Z VRB01MPS 9999 FEW026TCU FEW026 36/23 Q1003 NOSIG',
  lat: 30.576, lon: 103.95, elev: 494, name: 'Chengdu/Shuangliu Intl, CQ, CN',
  cover: 'FEW', clouds: [{ cover: 'FEW', base: 2600 }], fltCat: 'VFR',
}];

function fetcherReturning(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('metarInput', () => {
  it('accepts a single ICAO id', () => {
    expect(metarInput.parse({ icao: 'ZUUU' })).toEqual({ icaoIds: ['ZUUU'] });
  });

  it('splits, trims, uppercases and dedupes a comma-separated list', () => {
    expect(metarInput.parse({ icao: ' zuuu, kjfk ,zuuu' })).toEqual({ icaoIds: ['ZUUU', 'KJFK'] });
  });

  it('rejects a malformed ICAO id before any fetch would happen', () => {
    expect(() => metarInput.parse({ icao: 'not-a-real-icao-code' })).toThrow(AppError);
  });

  it('rejects more than 10 ids', () => {
    const many = Array.from({ length: 11 }, (_, i) => `A${i}BC`).join(',');
    expect(() => metarInput.parse({ icao: many })).toThrow(/At most 10/);
  });
});

describe('fetchMetar', () => {
  it('builds the ids= and format=json query and normalizes the response', async () => {
    const fetcher = fetcherReturning(SAMPLE);
    const stations = await fetchMetar(fetcher, ['ZUUU']);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://aviationweather.gov/api/data/metar');
    expect(url.searchParams.get('ids')).toBe('ZUUU');
    expect(url.searchParams.get('format')).toBe('json');
    expect(stations).toEqual([{
      icaoId: 'ZUUU', name: 'Chengdu/Shuangliu Intl, CQ, CN',
      observedAt: '2026-08-25T08:00:00.000Z',
      rawText: 'METAR ZUUU 250800Z VRB01MPS 9999 FEW026TCU FEW026 36/23 Q1003 NOSIG',
      flightCategory: 'VFR', temperatureC: 36, dewpointC: 23,
      windDirection: 'VRB', windSpeedKt: 2, visibility: '6+', altimeterHpa: 1003,
      clouds: [{ cover: 'FEW', base: 2600 }],
      latitude: 30.576, longitude: 103.95, elevationM: 494,
    }]);
  });

  it('passes multiple ids as one comma-joined upstream call', async () => {
    const fetcher = fetcherReturning(SAMPLE);
    await fetchMetar(fetcher, ['ZUUU', 'KJFK']);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('ids')).toBe('ZUUU,KJFK');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('execute', () => {
  it('returns requested + stations on a full hit', async () => {
    const fetcher = fetcherReturning(SAMPLE);
    const result = await execute(fetcher, { icao: 'ZUUU' });
    expect(result.requested).toEqual(['ZUUU']);
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0].icaoId).toBe('ZUUU');
  });

  it('throws STATION_NOT_FOUND (404) when the upstream returns nothing', async () => {
    const fetcher = fetcherReturning([]);
    await expect(execute(fetcher, { icao: 'ZZZZ' })).rejects.toMatchObject({ code: 'STATION_NOT_FOUND', status: 404 });
  });

  it('surfaces a partial miss: requested lists what was asked, stations lists what came back', async () => {
    // Confirmed against the live API: an unknown-but-well-formed id is silently
    // omitted rather than erroring, so ids=ZUUU,ZZZZ returns only ZUUU.
    const fetcher = fetcherReturning(SAMPLE);
    const result = await execute(fetcher, { icao: 'ZUUU,ZZZZ' });
    expect(result.requested).toEqual(['ZUUU', 'ZZZZ']);
    expect(result.stations.map((s) => s.icaoId)).toEqual(['ZUUU']);
  });

  it('rejects an empty icao before touching the fetcher', async () => {
    const fetcher = fetcherReturning(SAMPLE);
    await expect(execute(fetcher, { icao: '' })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a whitespace/comma-only icao (AppError, past zod but caught by parseIcaoList)', async () => {
    const fetcher = fetcherReturning(SAMPLE);
    await expect(execute(fetcher, { icao: ' , ' })).rejects.toBeInstanceOf(AppError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
