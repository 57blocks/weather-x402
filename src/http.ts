import type { Fetcher } from './types.js';
import { AppError } from './errors.js';

export async function fetchJson(fetcher: Fetcher, url: string | URL, init: RequestInit = {}, timeoutMs = 10_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'AgentSmith-Weather-METAR/0.1', ...init.headers } });
    const text = await response.text();
    if (!response.ok) throw new AppError('UPSTREAM_ERROR', `Provider returned HTTP ${response.status}`, 502, { status: response.status, body: text.slice(0, 300) });
    try { return JSON.parse(text); } catch { throw new AppError('UPSTREAM_INVALID_RESPONSE', 'Provider returned invalid JSON', 502); }
  } finally { clearTimeout(timer); }
}
