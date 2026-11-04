import { Easing, interpolate } from "remotion";
import type { FlightPhase, RenderProps, RunwayGeom } from "../types";
import { buildPhaseRuns, type PhaseRun } from "./timeline";

export type Vec = { x: number; y: number };

const v = (x: number, y: number): Vec => ({ x, y });
const sub = (a: Vec, b: Vec): Vec => v(a.x - b.x, a.y - b.y);
const len = (a: Vec): number => Math.hypot(a.x, a.y);
const lerp = (a: Vec, b: Vec, k: number): Vec =>
  v(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);

export type RunwayFrame = {
  /** Threshold of the active runway end (where landing aircraft cross). */
  threshold: Vec;
  /** Opposite end of the active runway. */
  farEnd: Vec;
  /** Unit vector in the landing direction. */
  u: Vec;
  /** Unit vector to the pilot's left when landing. */
  left: Vec;
  /** Active runway length in map units. */
  length: number;
  runway: RunwayGeom;
};

const FALLBACK_RUNWAY: RunwayGeom = {
  name: "9/27",
  le: { ident: "9", x: 0.35, y: 0.5 },
  he: { ident: "27", x: 0.65, y: 0.5 },
  width: 0.008,
};

export const runwayFrame = (runways: RunwayGeom[], active: string): RunwayFrame => {
  const norm = (s: string) => s.toUpperCase().replace(/^0+/, "").trim();
  const noSuffix = (s: string) => norm(s).replace(/[LRC]$/, "");
  const landingOn = (r: RunwayGeom, end: "le" | "he") => {
    const far = end === "he" ? r.le : r.he;
    return { runway: r, threshold: v(r[end].x, r[end].y), farEnd: v(far.x, far.y) };
  };
  const find = (key: (ident: string) => string) => {
    const want = key(active);
    if (!want) {
      return null;
    }
    for (const r of runways) {
      if (key(r.he.ident) === want) {
        return landingOn(r, "he");
      }
      if (key(r.le.ident) === want) {
        return landingOn(r, "le");
      }
    }
    return null;
  };
  // An exact end first, then the same heading on a parallel ("28C" when the data only has 28L/28R).
  const { runway, threshold, farEnd } =
    find(norm) ?? find(noSuffix) ?? landingOn(runways[0] ?? FALLBACK_RUNWAY, "he");
  const d = sub(farEnd, threshold);
  const length = Math.max(1e-4, len(d));
  const u = v(d.x / length, d.y / length);
  // Screen space is y-down, so "left of travel" is (u.y, -u.x).
  const left = v(u.y, -u.x);
  return { threshold, farEnd, u, left, length, runway };
};

/** Point in runway-relative units: a along the landing direction, b to the left, both in runway lengths. */
const rel = (f: RunwayFrame, a: number, b: number): Vec =>
  v(
    f.threshold.x + (f.u.x * a + f.left.x * b) * f.length,
    f.threshold.y + (f.u.y * a + f.left.y * b) * f.length,
  );

/** Schematic control points for each phase, in runway-relative units. */
const PHASE_POINTS: Record<FlightPhase, [number, number][]> = {
  final: [
    [-1.85, 0],
    [-1.2, 0],
    [-0.55, 0],
  ],
  "go-around": [
    [-0.2, 0],
    [0.5, 0],
    [1.15, 0],
    [1.5, 0.1],
    [1.78, 0.34],
    [1.95, 0.62],
  ],
  vectors: [
    [1.95, 0.62],
    [1.9, 1.05],
    [1.45, 1.32],
    [0.3, 1.42],
    [-1.0, 1.36],
    [-1.9, 1.1],
    [-2.25, 0.55],
    [-2.1, 0.12],
    [-1.85, 0],
  ],
  landing: [
    [-0.55, 0],
    [-0.1, 0],
    [0.08, 0],
    [0.3, 0],
    [0.45, 0],
  ],
  taxi: [
    [0.45, 0],
    [0.5, 0.0],
    [0.55, 0.05],
    [0.58, 0.15],
    [0.59, 0.27],
  ],
};

const PHASE_EASING: Record<FlightPhase, (t: number) => number> = {
  final: (t) => t,
  "go-around": Easing.bezier(0.35, 0.05, 0.6, 1),
  vectors: (t) => t,
  // Near-constant approach speed, touching down a little past halfway, then a long rollout.
  landing: Easing.bezier(0.3, 0.35, 0.55, 1),
  taxi: Easing.bezier(0.45, 0, 0.4, 1),
};

/** Catmull-Rom through the control points, then sampled by arc length. */
type Polyline = { points: Vec[]; cum: number[]; total: number };

const catmullRom = (pts: Vec[], samplesPerSpan = 18): Vec[] => {
  if (pts.length < 2) {
    return pts;
  }
  const out: Vec[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSpan; s++) {
      const t = s / samplesPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(
        v(
          0.5 *
            (2 * p1.x +
              (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          0.5 *
            (2 * p1.y +
              (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        ),
      );
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
};

const toPolyline = (points: Vec[]): Polyline => {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + len(sub(points[i], points[i - 1])));
  }
  return { points, cum, total: cum[cum.length - 1] };
};

const pointAt = (pl: Polyline, k: number): { pos: Vec; dir: Vec } => {
  const n = pl.points.length;
  if (n === 1 || pl.total === 0) {
    return { pos: pl.points[0], dir: v(0, -1) };
  }
  const target = Math.min(1, Math.max(0, k)) * pl.total;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pl.cum[mid] <= target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const spanLen = pl.cum[hi] - pl.cum[lo] || 1;
  const pos = lerp(pl.points[lo], pl.points[hi], (target - pl.cum[lo]) / spanLen);
  const dir = sub(pl.points[hi], pl.points[lo]);
  return { pos, dir };
};

type Box = { minX: number; minY: number; maxX: number; maxY: number };

const boxOf = (pts: Vec[]): Box => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

export type Camera = { cx: number; cy: number; scale: number };

const fitCamera = (box: Box, w: number, h: number, pad: number): Camera => {
  const bw = Math.max(1e-3, box.maxX - box.minX);
  const bh = Math.max(1e-3, box.maxY - box.minY);
  const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale };
};

export type FlightRun = PhaseRun & {
  path: Polyline;
  camera: Camera;
  /** Geometry of this run's runway (runs can switch runways after a go-around). */
  frame: RunwayFrame;
  approachCourse: [Vec, Vec];
};

export type FlightModel = {
  frame: RunwayFrame;
  runs: FlightRun[];
  /** Approach course drawn along the extended centerline. */
  approachCourse: [Vec, Vec];
  airportCenter: Vec;
};

export const buildFlightModel = (
  props: RenderProps,
  viewW: number,
  viewH: number,
): FlightModel => {
  const frame = runwayFrame(props.runways, props.activeRunway);
  const phaseRuns = buildPhaseRuns(props);
  const runwayPts =
    props.runways.length > 0
      ? props.runways.flatMap((r) => [v(r.le.x, r.le.y), v(r.he.x, r.he.y)])
      : [frame.threshold, frame.farEnd];
  const airportBox = boxOf(runwayPts);

  const runs: FlightRun[] = [];
  let prevEnd: Vec | null = null;
  for (const run of phaseRuns) {
    const runFrame = runwayFrame(props.runways, run.runway);
    const ctrl = PHASE_POINTS[run.phase].map(([a, b]) => rel(runFrame, a, b));
    if (prevEnd && len(sub(prevEnd, ctrl[0])) > frame.length * 0.02) {
      ctrl.unshift(prevEnd);
    } else if (prevEnd) {
      ctrl[0] = prevEnd;
    }
    const path = toPolyline(catmullRom(ctrl));
    prevEnd = path.points[path.points.length - 1];

    const onGround = run.phase === "landing" || run.phase === "taxi";
    const framed = onGround
      ? [runFrame.threshold, runFrame.farEnd, ...path.points, ...runwayPts]
      : [...path.points, ...runwayPts];
    const camera = fitCamera(
      boxOf(framed),
      viewW,
      viewH,
      onGround ? viewW * 0.1 : viewW * 0.09,
    );
    runs.push({
      ...run,
      path,
      camera,
      frame: runFrame,
      approachCourse: [runFrame.threshold, rel(runFrame, -2.4, 0)],
    });
  }

  return {
    frame,
    runs,
    approachCourse: [frame.threshold, rel(frame, -2.4, 0)],
    airportCenter: v((airportBox.minX + airportBox.maxX) / 2, (airportBox.minY + airportBox.maxY) / 2),
  };
};

const runIndexAt = (runs: FlightRun[], t: number): number => {
  let idx = 0;
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].startSec <= t) {
      idx = i;
    }
  }
  return idx;
};

/** The flight run in progress at time t (the first run before it starts), or null. */
export const runAt = (model: FlightModel, t: number): FlightRun | null =>
  model.runs.length === 0 ? null : model.runs[runIndexAt(model.runs, t)];

export type AircraftState = {
  pos: Vec;
  /** Heading in degrees, clockwise from north (screen up). */
  heading: number;
  phase: FlightPhase;
};

export const aircraftAt = (model: FlightModel, t: number): AircraftState | null => {
  if (model.runs.length === 0) {
    return null;
  }
  const run = model.runs[runIndexAt(model.runs, t)];
  const p = interpolate(t, [run.startSec, run.endSec], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: PHASE_EASING[run.phase],
  });
  const { pos, dir } = pointAt(run.path, p);
  const heading = (Math.atan2(dir.x, -dir.y) * 180) / Math.PI;
  return { pos, heading, phase: run.phase };
};

const CAMERA_BLEND_SEC = 1.8;

export const cameraAt = (model: FlightModel, t: number, fallback: Camera): Camera => {
  if (model.runs.length === 0) {
    return fallback;
  }
  const i = runIndexAt(model.runs, t);
  const cur = model.runs[i].camera;
  if (i === 0) {
    return cur;
  }
  const prev = model.runs[i - 1].camera;
  const k = interpolate(t, [model.runs[i].startSec, model.runs[i].startSec + CAMERA_BLEND_SEC], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  return {
    cx: prev.cx + (cur.cx - prev.cx) * k,
    cy: prev.cy + (cur.cy - prev.cy) * k,
    scale: Math.exp(Math.log(prev.scale) + (Math.log(cur.scale) - Math.log(prev.scale)) * k),
  };
};

export const currentRun = (model: FlightModel, t: number): FlightRun | null =>
  model.runs.length === 0 ? null : model.runs[runIndexAt(model.runs, t)];

/** Remaining part of the current run's path, for the magenta "active leg". */
export const pathAhead = (model: FlightModel, t: number): Vec[] => {
  const run = currentRun(model, t);
  if (!run) {
    return [];
  }
  const p = interpolate(t, [run.startSec, run.endSec], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: PHASE_EASING[run.phase],
  });
  const target = p * run.path.total;
  const ahead = run.path.points.filter((_, i) => run.path.cum[i] > target);
  return [pointAt(run.path, p).pos, ...ahead];
};
