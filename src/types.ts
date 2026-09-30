export type Fetcher = typeof fetch;
export type JsonSchema = Record<string, unknown>;

export interface MetarCloudLayer {
  cover: string;
  base: number | null;
}

/** Normalized per-station shape. Field names are our own, not aviationweather.gov's
 *  raw ones (icaoId/temp/dewp/...) — the raw shape is an implementation detail. */
export interface MetarStation {
  icaoId: string;
  name: string | null;
  observedAt: string | null;
  rawText: string | null;
  flightCategory: string | null;
  temperatureC: number | null;
  dewpointC: number | null;
  windDirection: string | number | null;
  windSpeedKt: number | null;
  visibility: string | number | null;
  altimeterHpa: number | null;
  clouds: MetarCloudLayer[];
  latitude: number | null;
  longitude: number | null;
  elevationM: number | null;
}

/** aviationweather.gov silently omits unknown/no-report stations instead of
 *  erroring per id, so `requested` lets a caller diff against `stations` to see
 *  which of their codes had no data. */
export interface MetarResult {
  requested: string[];
  stations: MetarStation[];
}
