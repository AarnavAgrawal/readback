/**
 * Enhanced Radar REST client (https://api.enhancedradar.com/api/v0).
 * Auth: `Authorization: Bearer <ENHANCED_RADAR_API_KEY>`.
 * Billing comes back in the X-Charged-Usd / X-Balance-Usd headers; every
 * charged call is appended to a costs.jsonl ledger.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { appendJsonl } from "./lib";

const BASE_URL = "https://api.enhancedradar.com";

// ---------- API shapes ----------

export type WordTimestamp = {
  word: string;
  start_seconds: number;
  end_seconds: number;
};

export type ErTranscript = {
  audio_sample_id: string;
  /** End of the audio, RFC 3339 UTC, accurate to ~20 s. */
  received_at: string;
  duration_seconds: number;
  atc_channel_id: number;
  facility_ids: string[];
  is_controller_speaking: boolean;
  callsigns: string[];
  transcript: string;
  /** REST: [] when unavailable. MCP-sourced seed data: null. */
  word_timestamps: WordTimestamp[] | null;
  search_score?: number;
};

export type ErEventUpdate = {
  event_update_id: number;
  update_to_event_id: number;
  happened_at: string;
  summary: string;
  callsigns: string[];
  evidence_audio_sample_ids: string[];
};

export type ErEvent = {
  event_id: number;
  atc_channel_id: number;
  facility_ids: string[];
  happened_at: string;
  summary: string;
  callsigns: string[];
  evidence_audio_sample_ids: string[];
  updates: ErEventUpdate[];
  similarity_score?: number;
};

export type ErChannel = {
  atc_channel_id: number;
  channel_name: string;
  channel_frequency_mhz: number;
  is_available: boolean;
};

export type ErFacility = {
  facility_id: string;
  facility_type: "airport" | "tracon" | "center";
  facility_code: string;
  facility_name: string;
  airport_municipality?: string | null;
  channel_categories?: {
    channel_category_id: number;
    channel_category_name: string;
    atc_channels: ErChannel[];
  }[];
};

export type ErAirline = {
  airline_id: number;
  icao: string;
  iata: string | null;
  telephony: string | null;
  name: string;
};

export type ErAudioLink = {
  audio_sample_id: string;
  audio_link: string;
  audio_link_expires_at: string;
};

// ---------- client ----------

export class ErError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId: string | null,
  ) {
    super(`Enhanced Radar ${status}: ${message}${requestId ? ` (request ${requestId})` : ""}`);
  }
}

type Query = Record<string, string | number | undefined | null>;

/**
 * Optional hook for apps that cap spending (the web demo). `reserve` runs with
 * a worst-case estimate before every paid call and may throw to refuse it;
 * `settle` always runs afterwards with what was actually charged.
 */
export type SpendGuard = {
  reserve(estimateUsd: number, path: string): Promise<void>;
  /** `balanceUsd` is the account balance the API last reported (null if none). */
  settle(estimateUsd: number, chargedUsd: number, balanceUsd: number | null, path: string): Promise<void>;
};

/**
 * Spend tracking is per request: Vercel reuses function instances across
 * concurrent requests, so this must not live in plain module state. The CLI
 * has a single flow and uses the default context.
 */
type SpendContext = { guard: SpendGuard | null; ledger: string | null };
const requestContext = new AsyncLocalStorage<SpendContext>();
const defaultContext: SpendContext = { guard: null, ledger: null };
const spendContext = () => requestContext.getStore() ?? defaultContext;

/** Runs `fn` with a spend guard that applies only to this call chain. */
export function withSpendGuard<T>(guard: SpendGuard, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ guard, ledger: null }, fn);
}

/** Ledger file that charged calls are appended to (set per story). */
export function setCostLedger(file: string) {
  spendContext().ledger = file;
}

let sessionSpendUsd = 0;
export function sessionSpend() {
  return sessionSpendUsd;
}

/** Worst-case cost of a request, from the published per-item prices. */
export function estimateCostUsd(pathname: string, query: Query): number {
  const limit = Number(query.limit ?? 0);
  if (pathname === "/api/v0/events") return 1 + (limit || 10); // search page + each event
  if (/^\/api\/v0\/events\/\d+$/.test(pathname)) return 1;
  if (pathname === "/api/v0/transcripts") return 0.03 * (limit || 100);
  if (/^\/api\/v0\/transcripts\/[^/]+\/audio$/.test(pathname)) return 0.05;
  if (/^\/api\/v0\/transcripts\/[^/]+$/.test(pathname)) return 0.03;
  if (pathname === "/api/v0/flights/status") return 0.12;
  return 0; // facilities, airlines, pricing are free
}

function apiKey(): string {
  const key = process.env.ENHANCED_RADAR_API_KEY;
  if (!key) {
    throw new Error(
      "ENHANCED_RADAR_API_KEY is not set. Create a REST key in the Enhanced Radar dashboard and add it to .env",
    );
  }
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET a JSON endpoint with retries on 429/5xx; records charges. */
export async function erGet<T>(pathname: string, query: Query = {}): Promise<T> {
  const url = new URL(pathname, BASE_URL);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const estimate = estimateCostUsd(url.pathname, query);
  const context = spendContext();
  if (context.guard && estimate > 0) await context.guard.reserve(estimate, url.pathname);

  const key = apiKey(); // a missing key is a config error, not a network failure
  let chargedTotal = 0;
  let lastBalance: number | null = null;
  try {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        // A paid call that timed out may have been charged, so it gets one retry, not three.
        if (attempt >= (estimate > 0 ? 1 : 3)) throw err;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      const requestId = res.headers.get("x-request-id");
      const charged = Number(res.headers.get("x-charged-usd") ?? "0");
      const balanceHeader = res.headers.get("x-balance-usd");
      const balance = balanceHeader === null ? NaN : Number(balanceHeader);
      if (Number.isFinite(balance)) lastBalance = balance;

      // Record every charge, including any on non-OK responses.
      if (Number.isFinite(charged) && charged > 0) {
        sessionSpendUsd += charged;
        chargedTotal += charged;
        if (context.ledger) {
          appendJsonl(context.ledger, {
            at: new Date().toISOString(),
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            status: res.status,
            charged_usd: charged,
            balance_usd: Number.isFinite(balance) ? balance : null,
          });
        }
      }

      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
      if (!retryable || attempt >= 3) throw new ErError(res.status, message, requestId);
      await sleep(1000 * 2 ** attempt);
    }
  } finally {
    if (context.guard && (estimate > 0 || chargedTotal > 0)) {
      // Bookkeeping must never lose a response that was already paid for.
      await context.guard.settle(estimate, chargedTotal, lastBalance, url.pathname).catch((err: unknown) => {
        console.error(`[spend] settle failed for ${url.pathname}`, err);
      });
    }
  }
}

// ---------- endpoints ----------

export type TranscriptQuery = {
  since: string;
  until: string;
  callsign?: string;
  facility_id?: string;
  atc_channel_ids?: number[];
  airline_id?: number;
  q?: string;
  match?: "all_words" | "phrase" | "any_words";
  limit?: number;
};

/** All pages of transcripts for a query (q-searches return a single page). */
export async function listTranscripts(params: TranscriptQuery, maxPages = 10): Promise<ErTranscript[]> {
  const out: ErTranscript[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res: { transcripts: ErTranscript[]; next_cursor: string | null } = await erGet(
      "/api/v0/transcripts",
      {
        since: params.since,
        until: params.until,
        callsign: params.callsign,
        facility_id: params.facility_id,
        atc_channel_ids: params.atc_channel_ids?.join(","),
        airline_id: params.airline_id,
        q: params.q,
        match: params.q ? params.match : undefined,
        limit: params.limit,
        cursor: cursor ?? undefined,
      },
    );
    out.push(...res.transcripts);
    cursor = res.next_cursor;
    if (!cursor || params.q) return out;
  }
  // Pages come newest first, so stopping early drops the OLDEST transmissions.
  console.warn(
    `! Stopped after ${maxPages} pages (${out.length} transcripts) for ${JSON.stringify(params)}; older transmissions were not fetched.`,
  );
  return out;
}

export function getEvent(eventId: number): Promise<ErEvent> {
  return erGet(`/api/v0/events/${eventId}`);
}

export async function searchEvents(params: {
  q: string;
  since: string;
  until: string;
  facility_id?: string;
  callsign?: string;
  airline_id?: number;
  limit?: number;
}): Promise<ErEvent[]> {
  const res = await erGet<{ events: ErEvent[] }>("/api/v0/events", params);
  return res.events;
}

export async function searchFacilities(q: string, facilityType?: string): Promise<ErFacility[]> {
  const res = await erGet<{ facilities: ErFacility[] }>("/api/v0/facilities/search", {
    q,
    facility_type: facilityType,
  });
  return res.facilities;
}

/** Free. Every covered facility with its channels. Cached for a day. */
export async function listFacilities(cacheFile: string): Promise<ErFacility[]> {
  if (isFresh(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8")).facilities;
  const res = await erGet<{ facilities: ErFacility[] }>("/api/v0/facilities");
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(res, null, 2));
  return res.facilities;
}

/** Free. Every airline. Cached for a day. */
export async function listAirlines(cacheFile: string): Promise<ErAirline[]> {
  if (isFresh(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8")).airlines;
  const res = await erGet<{ airlines: ErAirline[] }>("/api/v0/airlines");
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(res, null, 2));
  return res.airlines;
}

/**
 * Downloads one transmission's WAV. The signed link expires 3 minutes after
 * it is issued, and every link request is charged, so download immediately
 * and never re-request a clip that is already on disk.
 */
export async function downloadAudio(audioSampleId: string, destFile: string): Promise<void> {
  if (isValidWav(destFile)) return;
  const link = await erGet<ErAudioLink>(`/api/v0/transcripts/${encodeURIComponent(audioSampleId)}/audio`);
  // The signed link is only good for 3 minutes; fetch it now, retrying briefly.
  let buf: Buffer | null = null;
  for (let attempt = 0; attempt < 3 && !buf; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(link.audio_link, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) buf = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 2) throw new Error(`Audio download failed for ${audioSampleId}: ${String(err)}`);
    }
    if (res && !res.ok && res.status < 500) throw new Error(`Audio download failed for ${audioSampleId}: HTTP ${res.status}`);
    if (!buf && attempt < 2) await sleep(500 * (attempt + 1));
  }
  if (!buf) throw new Error(`Audio download failed for ${audioSampleId}`);
  // Write atomically so a crash never leaves a truncated file that looks cached.
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const part = `${destFile}.part`;
  fs.writeFileSync(part, buf);
  if (!isValidWav(part)) {
    fs.unlinkSync(part);
    throw new Error(`Downloaded audio for ${audioSampleId} is not a valid WAV`);
  }
  fs.renameSync(part, destFile);
}

/** True if the file exists and has a RIFF/WAVE header with some audio data. */
export function isValidWav(file: string): boolean {
  if (!fs.existsSync(file) || fs.statSync(file).size <= 44) return false;
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    return head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE";
  } finally {
    fs.closeSync(fd);
  }
}

/** A cache file younger than maxAge that came from the REST API (seed files carry a `_source` note). */
function isFresh(file: string, maxAgeMs = 24 * 3600 * 1000) {
  if (!fs.existsSync(file) || Date.now() - fs.statSync(file).mtimeMs >= maxAgeMs) return false;
  return !("_source" in (JSON.parse(fs.readFileSync(file, "utf8")) as object));
}
