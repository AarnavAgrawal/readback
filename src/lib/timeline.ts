import type { FlightPhase, RenderProps, Segment, Word } from "../types";

/** Index of the segment being spoken at time t, or -1. */
export const activeSegmentIndex = (segments: Segment[], t: number): number =>
  segments.findIndex((s) => t >= s.startSec && t < s.endSec);

/** Index of the last segment that started at or before t, or -1. */
export const latestSegmentIndex = (segments: Segment[], t: number): number => {
  let idx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startSec <= t) {
      idx = i;
    }
  }
  return idx;
};

export type PhaseRun = {
  phase: FlightPhase;
  /** Runway end this run flies to/from (segment.runway, or activeRunway if absent or empty). */
  runway: string;
  startSec: number;
  /** Always at least MIN_RUN_SEC past startSec, so interpolate() ranges stay strictly increasing. */
  endSec: number;
  /** Indices into props.segments, in time order. */
  segmentIndices: number[];
};

const MIN_RUN_SEC = 0.05;

const FLIGHT_PHASES: ReadonlySet<string> = new Set<FlightPhase>([
  "final",
  "go-around",
  "vectors",
  "landing",
  "taxi",
]);

/** Phases come from the model's storyboard: an unknown one flies as "final" instead of crashing the video. */
const normalizePhase = (phase: string): FlightPhase =>
  FLIGHT_PHASES.has(phase) ? (phase as FlightPhase) : "final";

const segmentRunway = (s: Segment, props: RenderProps): string =>
  (s.runway || props.activeRunway || "").toUpperCase();

/** Consecutive segments with the same phase and runway, stretched to cover the whole timeline. */
export const buildPhaseRuns = (props: RenderProps): PhaseRun[] => {
  // Sort indices, not segments: props stay untouched and segmentIndices keep pointing into them.
  const inTimeOrder = props.segments
    .map((_, i) => i)
    .sort((a, b) => props.segments[a].startSec - props.segments[b].startSec);

  const runs: PhaseRun[] = [];
  for (const i of inTimeOrder) {
    const s = props.segments[i];
    const last = runs[runs.length - 1];
    const phase = normalizePhase(s.phase);
    const runway = segmentRunway(s, props);
    if (last && last.phase === phase && last.runway === runway) {
      last.segmentIndices.push(i);
      continue;
    }
    runs.push({
      phase,
      runway,
      startSec: s.startSec,
      endSec: s.endSec,
      segmentIndices: [i],
    });
  }
  runs.forEach((run, i) => {
    const next = runs[i + 1];
    const lastSeg = props.segments[run.segmentIndices[run.segmentIndices.length - 1]];
    run.endSec = next ? next.startSec : lastSeg.endSec + 2;
  });
  if (runs.length > 0) {
    runs[0].startSec = Math.max(0, Math.min(runs[0].startSec, props.introSec) - 1);
  }
  // Last, because the line above can move a start. Segments that share a start would otherwise give an empty run.
  for (const run of runs) {
    run.endSec = Math.max(run.endSec, run.startSec + MIN_RUN_SEC);
  }
  return runs;
};

/** When the end card begins. */
export const outroStartSec = (props: RenderProps): number => {
  const ends = [
    ...props.segments.map((s) => s.endSec),
    ...props.explainers.map((e) => e.endSec),
    ...props.timeJumps.map((j) => j.endSec),
    props.introSec,
  ];
  const contentEnd = Math.max(...ends) + 0.8;
  return Math.min(contentEnd, Math.max(props.introSec, props.totalSec - 3));
};

/**
 * Words for karaoke. Falls back to evenly spread words when the pipeline gave none,
 * so captions always show the verbatim text.
 */
export const segmentWords = (seg: Segment): Word[] => {
  if (seg.words.length > 0) {
    return seg.words;
  }
  const tokens = seg.text.split(/\s+/).filter(Boolean);
  const total = tokens.reduce((a, t) => a + t.length + 1, 0);
  const dur = seg.endSec - seg.startSec;
  let t = seg.startSec;
  return tokens.map((text) => {
    const d = (dur * (text.length + 1)) / Math.max(1, total);
    const w = { text, startSec: t, endSec: t + d };
    t += d;
    return w;
  });
};

const TIME_ZONES: Record<string, string> = {
  SFO: "America/Los_Angeles",
  LAX: "America/Los_Angeles",
  SAN: "America/Los_Angeles",
  SJC: "America/Los_Angeles",
  OAK: "America/Los_Angeles",
  SEA: "America/Los_Angeles",
  PDX: "America/Los_Angeles",
  LAS: "America/Los_Angeles",
  PHX: "America/Phoenix",
  DEN: "America/Denver",
  SLC: "America/Denver",
  DFW: "America/Chicago",
  IAH: "America/Chicago",
  ORD: "America/Chicago",
  MSP: "America/Chicago",
  ATL: "America/New_York",
  JFK: "America/New_York",
  LGA: "America/New_York",
  EWR: "America/New_York",
  BOS: "America/New_York",
  DCA: "America/New_York",
  IAD: "America/New_York",
  MIA: "America/New_York",
  CLT: "America/New_York",
  PHL: "America/New_York",
  DTW: "America/New_York",
  HNL: "Pacific/Honolulu",
  ANC: "America/Anchorage",
};

export const airportTimeZone = (airportCode: string): string =>
  TIME_ZONES[airportCode.toUpperCase().replace(/^K(?=[A-Z]{3}$)/, "")] ?? "UTC";

/** "05:58:04Z" */
export const formatUtc = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "--:--:--Z";
  }
  return `${d.toISOString().slice(11, 19)}Z`;
};

/** "9:58 PM PST" */
export const formatLocal = (
  iso: string,
  timeZone: string,
  seconds = false,
  withZone = true,
): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    timeZoneName: withZone ? "short" : undefined,
  }).format(d);
};

/** "120.5" -> "120.500" like a radio head. */
export const formatFrequency = (freq: string): string => {
  const n = Number(freq);
  return Number.isFinite(n) && freq.trim() !== "" ? n.toFixed(3) : freq;
};

const TELEPHONY: Record<string, string> = {
  UNITED: "UAL",
  AMERICAN: "AAL",
  DELTA: "DAL",
  SOUTHWEST: "SWA",
  ALASKA: "ASA",
  JETBLUE: "JBU",
  SPIRIT: "NKS",
  FRONTIER: "FFT",
  HAWAIIAN: "HAL",
  SKYWEST: "SKW",
  SPEEDBIRD: "BAW",
  LUFTHANSA: "DLH",
  "AIR CANADA": "ACA",
  CACTUS: "AWE",
  FEDEX: "FDX",
  UPS: "UPS",
};

/** Radar-style data-block callsign derived from the pilot's spoken callsign. */
export const deriveCallsign = (segments: Segment[]): string => {
  const pilot = segments.find((s) => s.role === "pilot");
  const label = (pilot?.speakerLabel ?? "").toUpperCase().trim();
  const m = label.match(/^([A-Z ]+?)\s*(\d+[A-Z]*)$/);
  if (m && TELEPHONY[m[1].trim()]) {
    return `${TELEPHONY[m[1].trim()]}${m[2]}`;
  }
  return label.replace(/\s+/g, "") || "TRAFFIC";
};

export const phaseLabel = (phase: FlightPhase, runway: string): string => {
  switch (phase) {
    case "final":
      return `Final ${runway}`;
    case "go-around":
      return "Go-around";
    case "vectors":
      return "Vectors";
    case "landing":
      return `Landing ${runway}`;
    case "taxi":
      return "Taxi";
    default:
      return phase;
  }
};
