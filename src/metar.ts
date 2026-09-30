import { z } from 'zod';
import type { Fetcher, MetarResult, MetarStation } from './types.js';
import { fetchJson } from './http.js';
import { AppError } from './errors.js';

/**
 * Aviation Weather Center METAR lookup — the one capability this service sells.
 *
 * Public, keyless upstream: https://aviationweather.gov/api/data/metar
 *
 * Confirmed by hand against the live API: a well-formed but unknown/no-report
 * ICAO id (e.g. `ZZZZ`) is silently omitted from the response array rather than
 * erroring — `ids=ZUUU,ZZZZ` returns only ZUUU. A malformed token (wrong
 * length/characters) gets a 400 from the upstream itself before it ever reaches
 * per-id matching. `execute()` below returns `{requested, stations}` so a
 * caller can diff the two and see which of their codes had no report, instead
 * of silently getting back fewer stations than it asked for.
 */

const AVIATIONWEATHER_METAR_URL = 'https://aviationweather.gov/api/data/metar';
const MAX_ICAO_IDS = 10;
const ICAO_RE = /^[A-Z0-9]{3,4}$/;

export const inputSchema = {
  type: 'object',
  properties: {
    icao: {
      type: 'string',
      description: `ICAO station id, or up to ${MAX_ICAO_IDS} comma-separated (e.g. "ZUUU" or "ZUUU,KJFK").`,
    },
  },
  required: ['icao'],
} as const;

export const outputSchema = {
  type: 'object',
  properties: {
    requested: { type: 'array', items: { type: 'string' }, description: 'ICAO ids that were asked for.' },
    stations: {
      type: 'array',
      description: 'One entry per station with a current report. Missing from `requested`? No recent METAR for that id.',
      items: {
        type: 'object',
        properties: {
          icaoId: { type: 'string' },
          name: { type: ['string', 'null'] },
          observedAt: { type: ['string', 'null'], description: 'ISO 8601 report time.' },
          rawText: { type: ['string', 'null'], description: 'Raw METAR text.' },
          flightCategory: { type: ['string', 'null'], description: 'VFR, MVFR, IFR, or LIFR.' },
          temperatureC: { type: ['number', 'null'] },
          dewpointC: { type: ['number', 'null'] },
          windDirection: { type: ['string', 'number', 'null'] },
          windSpeedKt: { type: ['number', 'null'] },
          visibility: { type: ['string', 'number', 'null'] },
          altimeterHpa: { type: ['number', 'null'] },
          clouds: { type: 'array', items: { type: 'object', properties: { cover: { type: 'string' }, base: { type: ['number', 'null'] } } } },
          latitude: { type: ['number', 'null'] },
          longitude: { type: ['number', 'null'] },
          elevationM: { type: ['number', 'null'] },
        },
      },
    },
  },
  required: ['requested', 'stations'],
} as const;

export const example = { icao: 'ZUUU' };
export const outputExample: MetarResult = {
  requested: ['ZUUU'],
  stations: [{
    icaoId: 'ZUUU', name: 'Chengdu/Shuangliu Intl, CQ, CN',
    observedAt: '2026-08-25T08:00:00.000Z',
    rawText: 'METAR ZUUU 250800Z VRB01MPS 9999 FEW026TCU FEW026 36/23 Q1003 NOSIG',
    flightCategory: 'VFR', temperatureC: 36, dewpointC: 23,
    windDirection: 'VRB', windSpeedKt: 2, visibility: '6+', altimeterHpa: 1003,
    clouds: [{ cover: 'FEW', base: 2600 }],
    latitude: 30.576, longitude: 103.95, elevationM: 494,
  }],
};

function parseIcaoList(raw: string): string[] {
  const ids = [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (ids.length === 0) throw new AppError('INVALID_INPUT', 'icao must not be empty', 400);
  if (ids.length > MAX_ICAO_IDS) throw new AppError('INVALID_INPUT', `At most ${MAX_ICAO_IDS} ICAO ids per request`, 400);
  const bad = ids.filter((id) => !ICAO_RE.test(id));
  if (bad.length) throw new AppError('INVALID_INPUT', `Not a valid ICAO id: ${bad.join(', ')}`, 400);
  return ids;
}

export const metarInput = z.object({ icao: z.string().min(1).max(200) })
  .transform((v) => ({ icaoIds: parseIcaoList(v.icao) }));

function normalize(raw: Record<string, any>): MetarStation {
  return {
    icaoId: raw.icaoId,
    name: raw.name ?? null,
    observedAt: raw.reportTime ?? null,
    rawText: raw.rawOb ?? null,
    flightCategory: raw.fltCat ?? null,
    temperatureC: raw.temp ?? null,
    dewpointC: raw.dewp ?? null,
    windDirection: raw.wdir ?? null,
    windSpeedKt: raw.wspd ?? null,
    visibility: raw.visib ?? null,
    altimeterHpa: raw.altim ?? null,
    clouds: Array.isArray(raw.clouds) ? raw.clouds.map((c: any) => ({ cover: c.cover, base: c.base ?? null })) : [],
    latitude: raw.lat ?? null,
    longitude: raw.lon ?? null,
    elevationM: raw.elev ?? null,
  };
}

export async function fetchMetar(fetcher: Fetcher, icaoIds: string[]): Promise<MetarStation[]> {
  const url = new URL(AVIATIONWEATHER_METAR_URL);
  url.searchParams.set('ids', icaoIds.join(','));
  url.searchParams.set('format', 'json');
  const raw = await fetchJson(fetcher, url);
  if (!Array.isArray(raw)) throw new AppError('UPSTREAM_INVALID_RESPONSE', 'Provider returned an unexpected shape', 502);
  return raw.map(normalize);
}

export async function execute(fetcher: Fetcher, rawInput: unknown): Promise<MetarResult> {
  const { icaoIds } = metarInput.parse(rawInput);
  const stations = await fetchMetar(fetcher, icaoIds);
  if (stations.length === 0) {
    throw new AppError('STATION_NOT_FOUND', `No current METAR report for: ${icaoIds.join(', ')}`, 404);
  }
  return { requested: icaoIds, stations };
}
