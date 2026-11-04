/** Shared helpers: paths, JSON I/O, WAV header, airports + runway geometry, time. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RunwayGeom } from "../src/types";

// ---------- paths ----------

export const ROOT = process.cwd();
/**
 * Where per-story working files live. Defaults to ./data and ./public; the
 * web app points these at a temp dir on Vercel (only /tmp is writable there)
 * and syncs results to Blob storage.
 */
const tmpDefault = (dir: string) => (process.env.VERCEL ? path.join(os.tmpdir(), "atc", dir) : path.join(ROOT, dir));
export const DATA_DIR = process.env.PIPELINE_DATA_DIR || tmpDefault("data");
export const PUBLIC_DIR = process.env.PIPELINE_PUBLIC_DIR || tmpDefault("public");
export const CACHE_DIR = path.join(DATA_DIR, "cache");

export function storyPaths(eventId: string | number) {
  const dir = path.join(DATA_DIR, "stories", String(eventId));
  const publicDir = path.join(PUBLIC_DIR, "stories", String(eventId));
  return {
    dir,
    event: path.join(dir, "event.json"),
    transcripts: path.join(dir, "transcripts.json"),
    clean: path.join(dir, "clean.json"),
    storyboard: path.join(dir, "storyboard.json"),
    timeline: path.join(dir, "timeline.json"),
    costs: path.join(dir, "costs.jsonl"),
    rawAudioDir: path.join(dir, "audio"),
    publicDir,
    storyWav: path.join(publicDir, "story.wav"),
    renderProps: path.join(publicDir, "render-props.json"),
    /** audioSrc for Remotion's staticFile() (relative to public/); the web app swaps in a URL. */
    audioSrc: `stories/${eventId}/story.wav`,
    outMp4: path.join(ROOT, "out", `${eventId}.mp4`),
  };
}

// ---------- JSON ----------

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function appendJsonl(file: string, row: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n");
}

export function sumLedger(file: string): number {
  if (!fs.existsSync(file)) return 0;
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .reduce((s, line) => {
      try {
        return s + Number((JSON.parse(line) as { charged_usd?: number }).charged_usd || 0);
      } catch {
        return s; // skip a malformed (e.g. half-written) line
      }
    }, 0);
}

// ---------- audio ----------

/**
 * Radio audio is band-limited to ~4 kHz, so 24 kHz loses nothing and keeps
 * story.wav small enough for every render tab / browser to load quickly.
 */
export const SAMPLE_RATE = 24000;

// ---------- airports & runways (OurAirports, public domain) ----------

/** One airport in data/airports.json (built by pipeline/build-airports.ts). */
export type AirportRecord = {
  icao: string;
  iata: string | null;
  name: string;
  lat: number;
  lon: number;
  runways: {
    le: { ident: string; lat: number; lon: number };
    he: { ident: string; lat: number; lon: number };
    width_ft: number;
  }[];
};

/** Bundled with the app (read-only), so it is resolved from the project root, not DATA_DIR. */
const AIRPORTS_FILE = path.join(ROOT, "data", "airports.json");
let airportTable: Record<string, AirportRecord> | null = null;

function airports(): Record<string, AirportRecord> {
  if (!airportTable) {
    if (!fs.existsSync(AIRPORTS_FILE)) {
      throw new Error(`Missing ${AIRPORTS_FILE}. Build it with: npx tsx pipeline/build-airports.ts`);
    }
    airportTable = readJson<Record<string, AirportRecord>>(AIRPORTS_FILE);
  }
  return airportTable;
}

export type AirportInfo = AirportRecord & { ident: string };

/**
 * "SFO", "HNL" (IATA) or "KSFO", "PHNL" (ICAO) → airport. 3-letter codes are
 * matched on IATA first, so non-K airports (Alaska, Hawaii…) resolve too.
 */
export function lookupAirport(code: string): AirportInfo {
  const c = code.toUpperCase().trim();
  const table = airports();
  if (table[c]) return { ident: c, ...table[c] };
  const byIata = Object.entries(table).find(([, a]) => a.iata === c);
  if (byIata) return { ident: byIata[0], ...byIata[1] };
  if (c.length === 3 && table[`K${c}`]) return { ident: `K${c}`, ...table[`K${c}`] };
  const byIcao = Object.entries(table).find(([, a]) => a.icao === c);
  if (byIcao) return { ident: byIcao[0], ...byIcao[1] };
  throw new Error(`Airport ${c} not found in data/airports.json`);
}

/**
 * The airport's runways projected onto a square 0..1 map (north up), fitted
 * with padding so the whole field is visible.
 */
export function runwayGeometry(code: string, padding = 0.14): RunwayGeom[] {
  const airport = lookupAirport(code);
  const rows = airport.runways;
  if (rows.length === 0) throw new Error(`No runway coordinates for ${airport.ident}`);

  const lat0 = rows.reduce((s, r) => s + r.le.lat, 0) / rows.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const proj = (lat: number, lon: number) => ({ x: lon * k, y: -lat });

  const ends = rows.map((r) => ({ r, a: proj(r.le.lat, r.le.lon), b: proj(r.he.lat, r.he.lon) }));
  const xs = ends.flatMap((e) => [e.a.x, e.b.x]);
  const ys = ends.flatMap((e) => [e.a.y, e.b.y]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
  const scale = (1 - 2 * padding) / span;
  // Center the field inside the square.
  const offX = (1 - (Math.max(...xs) - minX) * scale) / 2;
  const offY = (1 - (Math.max(...ys) - minY) * scale) / 2;
  const norm = (p: { x: number; y: number }) => ({
    x: +(offX + (p.x - minX) * scale).toFixed(4),
    y: +(offY + (p.y - minY) * scale).toFixed(4),
  });
  // Degrees of latitude → feet ≈ 364,000; width is normalized the same way.
  const ftToNorm = scale / 364000;

  return ends.map(({ r, a, b }) => ({
    name: `${r.le.ident}/${r.he.ident}`,
    le: { ident: r.le.ident, ...norm(a) },
    he: { ident: r.he.ident, ...norm(b) },
    width: +Math.max(0.006, r.width_ft * ftToNorm).toFixed(4),
  }));
}

// ---------- time ----------

/** IANA zones for common US airports; others fall back to a longitude guess. */
const AIRPORT_TZ: Record<string, string> = {
  SFO: "America/Los_Angeles", LAX: "America/Los_Angeles", SAN: "America/Los_Angeles",
  SJC: "America/Los_Angeles", OAK: "America/Los_Angeles", SEA: "America/Los_Angeles",
  PDX: "America/Los_Angeles", LAS: "America/Los_Angeles", PHX: "America/Phoenix",
  DEN: "America/Denver", SLC: "America/Denver", DFW: "America/Chicago",
  IAH: "America/Chicago", ORD: "America/Chicago", MSP: "America/Chicago",
  ATL: "America/New_York", JFK: "America/New_York", LGA: "America/New_York",
  EWR: "America/New_York", BOS: "America/New_York", DCA: "America/New_York",
  IAD: "America/New_York", MIA: "America/New_York", CLT: "America/New_York",
  DTW: "America/Detroit", ANC: "America/Anchorage", HNL: "Pacific/Honolulu",
};

export function airportTimeZone(code: string, lon: number): string {
  const tz = AIRPORT_TZ[code.toUpperCase().replace(/^K(?=[A-Z]{3}$)/, "")];
  if (tz) return tz;
  if (lon < -150) return "Pacific/Honolulu";
  if (lon < -130) return "America/Anchorage";
  if (lon < -115) return "America/Los_Angeles";
  if (lon < -101) return "America/Denver";
  if (lon < -87) return "America/Chicago";
  return "America/New_York";
}

/** "Nov 3, 2026 · 9:58 PM PT" */
export function localDateLine(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc);
  const date = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  // "PST"/"PDT" → "PT" reads better on screen.
  const shortZone = /^[A-Z][SD]T$/.test(zone) ? `${zone[0]}T` : zone;
  return `${date} · ${time} ${shortZone}`;
}

export const addSeconds = (iso: string, s: number) => new Date(new Date(iso).getTime() + s * 1000).toISOString();
