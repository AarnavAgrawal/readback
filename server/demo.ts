/**
 * Server-side logic for the web demo: spend cap, airports, cached discovery,
 * the story-building job (with progress events), and the gallery index.
 */
import fs from "node:fs";
import path from "node:path";
import { type SpendGuard, searchFacilities, withSpendGuard } from "../pipeline/er";
import { readJson, storyPaths, sumLedger } from "../pipeline/lib";
import {
  type Candidate,
  type CleanFile,
  type Storyboard,
  type Timeline,
  buildAudio,
  buildProps,
  clean,
  collect,
  discover,
  hasClaudeCredentials,
  storyboard,
} from "../pipeline/stages";
import type { RenderProps } from "../src/types";
import {
  getFile,
  getJson,
  hashGetAll,
  hashSet,
  kvDel,
  kvGet,
  kvIncrFloat,
  kvSet,
  kvSetNx,
  listFiles,
  putFile,
} from "./store";

// =====================================================================
// Spend cap
// =====================================================================

/**
 * The only limit on the demo: total Enhanced Radar usage on the account.
 *
 * Usage = starting credit − the lowest balance the API has reported, so it is
 * always the real figure, whatever spent it. To stop concurrent requests racing
 * past the cap, each paid call also reserves its worst-case cost in
 * `spend:inflight` until it settles. That key expires by itself, so a crashed
 * function can't eat into the cap permanently.
 *
 * After a top-up: raise DEMO_STARTING_CREDIT_USD and delete `er:balance`.
 */
export const totalCapUsd = () => Number(process.env.DEMO_TOTAL_CAP_USD || 800);
const startingCreditUsd = () => Number(process.env.DEMO_STARTING_CREDIT_USD || 1000);
const BALANCE_KEY = "er:balance";
const INFLIGHT_KEY = "spend:inflight";
const INFLIGHT_TTL = 600;
const DAY = 24 * 3600;

/** An error whose message is safe and useful to show visitors. */
export class BudgetError extends Error {}

const finiteOrNull = (v: unknown): number | null => {
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Records a reported balance. Keeps the lowest seen, since responses can arrive out of order. */
export async function recordBalance(balanceUsd: number) {
  const known = finiteOrNull(await kvGet(BALANCE_KEY));
  if (known === null || balanceUsd < known) await kvSet(BALANCE_KEY, balanceUsd);
}

/** Usage from the last reported balance. On an empty store the first paid response fills it in. */
async function reportedUsageUsd(): Promise<number> {
  const balance = finiteOrNull(await kvGet(BALANCE_KEY));
  return balance === null ? 0 : Math.max(0, startingCreditUsd() - balance);
}

/** Refuses any paid Enhanced Radar call that could push total usage past the cap. */
const budgetGuard: SpendGuard = {
  async reserve(estimateUsd) {
    const inflight = await kvIncrFloat(INFLIGHT_KEY, estimateUsd, INFLIGHT_TTL);
    if ((await reportedUsageUsd()) + inflight > totalCapUsd()) {
      await kvIncrFloat(INFLIGHT_KEY, -estimateUsd, INFLIGHT_TTL);
      throw new BudgetError(
        "This demo has hit its credit limit, so new videos are paused. Everything in the gallery still works.",
      );
    }
  },
  async settle(estimateUsd, _chargedUsd, balanceUsd) {
    if (balanceUsd !== null) await recordBalance(balanceUsd); // before releasing, so usage never dips
    if (estimateUsd > 0) await kvIncrFloat(INFLIGHT_KEY, -estimateUsd, INFLIGHT_TTL);
  },
};

/** "0123" and "123" are the same event: one canonical id, or null if invalid. */
export function canonicalEventId(raw: unknown): string | null {
  const s = String(raw ?? "");
  return /^[1-9]\d{0,11}$/.test(s) ? s : null;
}

// =====================================================================
// Airports
// =====================================================================

/** Busy US airports offered in the demo; coverage is checked against Enhanced Radar (free call). */
const DEMO_AIRPORTS = ["SFO", "JFK", "LAX", "ORD", "ATL", "DEN", "BOS", "SEA", "DFW", "LAS", "EWR", "MIA"];

export type DemoAirport = { code: string; name: string; facilityId: string };

export async function demoAirports(): Promise<DemoAirport[]> {
  const cached = await kvGet<DemoAirport[]>("airports:v1");
  if (cached?.length) return cached;
  const found: DemoAirport[] = [];
  for (const code of DEMO_AIRPORTS) {
    const f = (await searchFacilities(code, "airport")).find((x) => x.facility_code === code);
    if (f) found.push({ code, name: f.facility_name, facilityId: f.facility_id });
  }
  await kvSet("airports:v1", found, DAY);
  return found;
}

// =====================================================================
// Discovery (cached per airport)
// =====================================================================

export type DiscoverResult = { airport: string; fetchedAt: string; candidates: Candidate[]; costUsd: number };
const DISCOVER_TTL = 6 * 3600;
const DISCOVER_QUERIES = ["go around", "declaring an emergency", "TCAS resolution advisory"];
const DISCOVER_LIMIT = 3; // ≤ 3 × (1 + 3) = $12 per refresh

export async function discoverCached(airport: string, opts: { refresh?: boolean } = {}): Promise<DiscoverResult> {
  const code = airport.toUpperCase();
  const key = `discover:${code}`;
  if (!opts.refresh) {
    const cached = await kvGet<DiscoverResult>(key);
    if (cached) return cached;
  }
  const lock = `lock:discover:${code}`;
  // TTL above the route's 120 s limit, so the lock can't expire under a running search.
  if (!(await kvSetNx(lock, "1", 150))) throw new BudgetError(`Already searching ${code}; try again in a moment.`);
  let costUsd = 0;
  const guard: SpendGuard = {
    reserve: budgetGuard.reserve,
    settle: async (estimate, charged, balance, path) => {
      costUsd += charged;
      await budgetGuard.settle(estimate, charged, balance, path);
    },
  };
  try {
    const { candidates } = await withSpendGuard(guard, () =>
      discover({ airport: code, hours: 24, queries: DISCOVER_QUERIES, limit: DISCOVER_LIMIT }),
    );
    const result: DiscoverResult = { airport: code, fetchedAt: new Date().toISOString(), candidates, costUsd: +costUsd.toFixed(2) };
    await kvSet(key, result, DISCOVER_TTL);
    return result;
  } finally {
    await kvDel(lock);
  }
}

// =====================================================================
// Gallery index
// =====================================================================

export type StorySummary = {
  eventId: string;
  title: string;
  hook: string;
  airportCode: string;
  airportName: string;
  dateLine: string;
  callsign: string | null;
  durationSec: number;
  clips: number;
  transmissionsReviewed: number;
  costUsd: number;
  storyboardBy: string;
  createdAt: string;
  featured: boolean;
  propsUrl: string;
};

const INDEX_KEY = "stories:index";

export async function listStories(): Promise<StorySummary[]> {
  const all = Object.values(await hashGetAll<StorySummary>(INDEX_KEY));
  return all.sort((a, b) => Number(b.featured) - Number(a.featured) || b.createdAt.localeCompare(a.createdAt));
}

export async function getStoryProps(eventId: string): Promise<RenderProps | null> {
  return getJson<RenderProps>(`stories/${eventId}/render-props.json`);
}

// =====================================================================
// Building a story
// =====================================================================

export type StageName = "collect" | "clean" | "storyboard" | "audio" | "publish";
export type ProgressEvent =
  | { type: "stage"; stage: StageName; status: "start" | "done"; detail?: string }
  | { type: "done"; story: StorySummary; props: RenderProps }
  | { type: "error"; message: string };

/** Copies a story's stored working files into the local working dir (skips files already present). */
async function hydrate(eventId: string) {
  const p = storyPaths(eventId);
  for (const key of await listFiles(`stories/${eventId}/data/`)) {
    const rel = key.slice(`stories/${eventId}/data/`.length);
    const dest = path.resolve(p.dir, ...rel.split("/"));
    if (!dest.startsWith(path.resolve(p.dir) + path.sep)) continue; // never write outside the story dir
    if (fs.existsSync(dest)) continue;
    const buf = await getFile(key);
    if (buf) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
  }
}

/**
 * Uploads a story's resumable working files, so a retry on another instance
 * doesn't pay for the same data twice. An explicit allowlist: Blob is public,
 * so nothing else (like the cost ledger) goes up.
 */
const WORKING_FILES = ["event.json", "transcripts.json", "clean.json", "storyboard.json", "timeline.json"];

async function persistWorkingFiles(eventId: string) {
  const p = storyPaths(eventId);
  for (const name of WORKING_FILES) {
    const file = path.join(p.dir, name);
    if (fs.existsSync(file)) await putFile(`stories/${eventId}/data/${name}`, fs.readFileSync(file), "application/json");
  }
  if (!fs.existsSync(p.rawAudioDir)) return;
  for (const name of fs.readdirSync(p.rawAudioDir).filter((f) => f.endsWith(".wav"))) {
    await putFile(`stories/${eventId}/data/audio/${name}`, fs.readFileSync(path.join(p.rawAudioDir, name)), "audio/wav");
  }
}

/**
 * Publishes a built story: uploads story.wav + render-props.json (with the
 * audio URL swapped in) and adds it to the gallery index.
 */
export async function publishStory(eventId: string, opts: { featured?: boolean } = {}): Promise<{ story: StorySummary; props: RenderProps }> {
  const p = storyPaths(eventId);
  const props = readJson<RenderProps>(p.renderProps);
  const audioUrl = await putFile(`stories/${eventId}/story.wav`, fs.readFileSync(p.storyWav), "audio/wav");
  const published: RenderProps = { ...props, audioSrc: audioUrl };
  const propsUrl = await putFile(`stories/${eventId}/render-props.json`, JSON.stringify(published), "application/json");

  const sb = readJson<Storyboard>(p.storyboard);
  const cleanFile = readJson<CleanFile>(p.clean);
  const timeline = readJson<Timeline>(p.timeline);
  const existing = (await hashGetAll<StorySummary>(INDEX_KEY))[eventId];
  const story: StorySummary = {
    eventId,
    title: props.title,
    hook: props.hook,
    airportCode: props.airportCode,
    airportName: props.airportName,
    dateLine: props.dateLine,
    callsign: props.callsign ?? null,
    durationSec: timeline.totalSec,
    clips: timeline.segments.length,
    transmissionsReviewed: cleanFile.transmissions.length,
    // Logged spend, or the list-price equivalent if some data was fetched
    // before logging existed (event $1 + $0.03/transcript + $0.02/clip).
    costUsd: +Math.max(
      sumLedger(p.costs),
      1 + 0.03 * readJson<{ transcripts: unknown[] }>(p.transcripts).transcripts.length + 0.02 * timeline.segments.length,
    ).toFixed(2),
    storyboardBy: sb.generated_by,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    featured: opts.featured ?? existing?.featured ?? false,
    propsUrl,
  };
  await hashSet(INDEX_KEY, eventId, story);
  await kvDel(`render:${eventId}`); // any earlier MP4 no longer matches this version
  await persistWorkingFiles(eventId).catch((err: unknown) => console.error(`[publish] ${eventId} working files`, err));
  return { story, props: published };
}

export async function buildStory(eventId: string, emit: (e: ProgressEvent) => void): Promise<void> {
  if (canonicalEventId(eventId) !== eventId) throw new BudgetError("That isn't a valid event.");

  // Already built? Serve it instantly (and for free).
  const existing = (await hashGetAll<StorySummary>(INDEX_KEY))[eventId];
  const existingProps = existing ? await getStoryProps(eventId) : null;
  if (existing && existingProps) {
    emit({ type: "done", story: existing, props: existingProps });
    return;
  }

  // One build per event. TTL above the route's 300 s limit, so it can't expire under a running build.
  const lock = `lock:build:${eventId}`;
  if (!(await kvSetNx(lock, "1", 330))) {
    throw new BudgetError("This video is already being built. It will appear in the gallery shortly.");
  }
  try {
    await withSpendGuard(budgetGuard, () => runBuild(eventId, emit));
  } catch (err) {
    // Keep whatever was paid for, so a retry resumes instead of paying again.
    await persistWorkingFiles(eventId).catch(() => undefined);
    throw err;
  } finally {
    if (process.env.PIPELINE_DATA_DIR || process.env.VERCEL) {
      // Reused function instances keep /tmp; don't let working files pile up.
      const p = storyPaths(eventId);
      fs.rmSync(p.dir, { recursive: true, force: true });
      fs.rmSync(p.publicDir, { recursive: true, force: true });
    }
    await kvDel(lock); // last, so a retry can't start while files are being removed
  }
}

async function runBuild(eventId: string, emit: (e: ProgressEvent) => void): Promise<void> {
  const id = Number(eventId);
  await hydrate(eventId);
  const p = storyPaths(eventId);
  if (!fs.existsSync(p.storyboard) && !hasClaudeCredentials()) {
    throw new Error("No Claude credentials"); // fail before spending anything
  }

  emit({ type: "stage", stage: "collect", status: "start" });
  await collect(id);
  await persistWorkingFiles(eventId); // paid data survives a failure later in the build
  const n = readJson<{ transcripts: unknown[] }>(p.transcripts).transcripts.length;
  emit({ type: "stage", stage: "collect", status: "done", detail: `${n} radio transmissions for this flight` });

  emit({ type: "stage", stage: "clean", status: "start" });
  await clean(id);
  const cleanFile = readJson<CleanFile>(p.clean);
  emit({
    type: "stage",
    stage: "clean",
    status: "done",
    detail: `${cleanFile.transmissions.length} unique after removing ${n - cleanFile.transmissions.length} duplicate captures`,
  });

  emit({ type: "stage", stage: "storyboard", status: "start" });
  const sb = await storyboard(id);
  await persistWorkingFiles(eventId); // a retry won't pay Claude again
  emit({ type: "stage", stage: "storyboard", status: "done", detail: `“${sb.title}” · ${sb.beats.length} beats` });

  emit({ type: "stage", stage: "audio", status: "start" });
  const timeline = await buildAudio(id);
  emit({
    type: "stage",
    stage: "audio",
    status: "done",
    detail: `${timeline.segments.length} clips · ${timeline.totalSec.toFixed(0)} s track`,
  });

  emit({ type: "stage", stage: "publish", status: "start" });
  buildProps(id);
  const { story, props } = await publishStory(eventId);
  emit({ type: "stage", stage: "publish", status: "done", detail: `Cost $${story.costUsd.toFixed(2)}` });
  emit({ type: "done", story, props });
}
