import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import {
  aircraftAt,
  buildFlightModel,
  cameraAt,
  runAt,
  pathAhead,
  type Camera,
  type Vec,
} from "../lib/flightPath";
import { phaseLabel } from "../lib/timeline";
import { C, FONT, MONO } from "../theme";
import type { RenderProps } from "../types";

type Props = {
  story: RenderProps;
  callsign: string;
  width: number;
  height: number;
};

const AIRCRAFT_PATH =
  "M0,-26 C2.6,-26 3.4,-22 3.4,-16 L3.4,-6 L24,6 L24,10 L3.4,4 L3.2,16 L9,21 L9,24 L0,22 L-9,24 L-9,21 L-3.2,16 L-3.4,4 L-24,10 L-24,6 L-3.4,-6 L-3.4,-16 C-3.4,-22 -2.6,-26 0,-26 Z";

export const AirportMap: React.FC<Props> = ({ story, callsign, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const model = useMemo(() => buildFlightModel(story, width, height), [story, width, height]);
  const fallback: Camera = { cx: 0.5, cy: 0.5, scale: Math.min(width, height) };
  const cam = cameraAt(model, t, fallback);
  const project = (p: Vec): Vec => ({
    x: width / 2 + (p.x - cam.cx) * cam.scale,
    y: height / 2 + (p.y - cam.cy) * cam.scale,
  });
  const toPoints = (pts: Vec[]) =>
    pts
      .map(project)
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");

  const L = model.frame.length;
  const center = project(model.airportCenter);
  const ringRadii = [0.5, 1, 1.5, 2, 3, 4].map((k) => k * L * cam.scale);

  // World-anchored grid, so the scope visibly pans with the camera.
  const gridStep = (L / 2) * cam.scale;
  const gridOffsetX = ((center.x % gridStep) + gridStep) % gridStep;
  const gridOffsetY = ((center.y % gridStep) + gridStep) % gridStep;
  const gridX: number[] = [];
  const gridY: number[] = [];
  for (let x = gridOffsetX; x < width; x += gridStep) gridX.push(x);
  for (let y = gridOffsetY; y < height; y += gridStep) gridY.push(y);

  const aircraft = aircraftAt(model, t);
  const firstStart = model.runs[0]?.startSec ?? 0;
  const history: Vec[] = [];
  for (let k = 1; k <= 14; k++) {
    const tk = t - k * 0.45;
    if (tk < firstStart) break;
    const s = aircraftAt(model, tk);
    if (s) history.push(project(s.pos));
  }
  const ahead = pathAhead(model, t);
  const acScreen = aircraft ? project(aircraft.pos) : null;
  const onGround = aircraft?.phase === "landing" || aircraft?.phase === "taxi";

  const sweepAngle = (t * 90) % 360;
  // The runway in play right now (a story can switch runways after a go-around).
  const currentRun = runAt(model, t);
  const runwayNow = currentRun?.runway ?? story.activeRunway.toUpperCase();
  const [crsA, crsB] = (currentRun?.approachCourse ?? model.approachCourse).map(project);
  const activeRunwayName = (currentRun?.frame ?? model.frame).runway.name;
  const activeIdent = runwayNow.toUpperCase();

  const candidates = story.runways.flatMap((r) =>
    [r.le, r.he].map((end, i) => {
      const other = i === 0 ? r.he : r.le;
      const p = project({ x: end.x, y: end.y });
      const q = project({ x: other.x, y: other.y });
      const d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const active = end.ident.toUpperCase().replace(/^0+/, "") === activeIdent.replace(/^0+/, "");
      const off = active ? 52 : 34;
      return {
        key: `${r.name}-${end.ident}`,
        ident: end.ident,
        active,
        x: p.x + ((p.x - q.x) / d) * off,
        y: p.y + ((p.y - q.y) / d) * off,
      };
    }),
  );
  candidates.sort((a, b) => Number(b.active) - Number(a.active));
  const labels: typeof candidates = [];
  for (const c of candidates) {
    const minGap = c.active ? 0 : 52;
    if (labels.every((l) => Math.hypot(l.x - c.x, l.y - c.y) > (l.active ? 70 : minGap))) {
      labels.push(c);
    }
  }

  // Keep the data block on screen: flip it left/down near the edges.
  const blockW = 250;
  const blockH = 72;
  const activeLabel = labels.find((l) => l.active);
  // Prefer the side behind the aircraft so the block never sits on the path ahead.
  const hdg = ((aircraft?.heading ?? 0) * Math.PI) / 180;
  const placements = (
    [
      [1, -1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ] as [number, number][]
  ).sort((a, b) => a[0] * Math.sin(hdg) - a[1] * Math.cos(hdg) - (b[0] * Math.sin(hdg) - b[1] * Math.cos(hdg)));
  const rectFor = ([dx, dy]: [number, number]) => {
    const x0 = !acScreen ? 0 : dx > 0 ? acScreen.x + 60 : acScreen.x - 60 - blockW;
    const y0 = !acScreen ? 0 : dy < 0 ? acScreen.y - 112 : acScreen.y + 52;
    return { x0, y0 };
  };
  const fits = (pl: [number, number]) => {
    const { x0, y0 } = rectFor(pl);
    return x0 >= 16 && x0 + blockW <= width - 16 && y0 >= 70 && y0 + blockH <= height - 16;
  };
  const clearOfLabel = (pl: [number, number]) => {
    if (!activeLabel) return true;
    const { x0, y0 } = rectFor(pl);
    return (
      activeLabel.x + 60 < x0 ||
      activeLabel.x - 60 > x0 + blockW ||
      activeLabel.y + 30 < y0 ||
      activeLabel.y - 30 > y0 + blockH
    );
  };
  const [leaderDx, leaderDy] =
    placements.find((pl) => fits(pl) && clearOfLabel(pl)) ?? placements.find(fits) ?? placements[0];
  const flipX = leaderDx < 0;
  const flipY = leaderDy > 0;

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        borderRadius: 28,
        background: `radial-gradient(120% 90% at 50% 45%, ${C.panel} 0%, ${C.scope} 60%, ${C.scopeDeep} 100%)`,
        boxShadow: `inset 0 0 0 2px ${C.grid}, inset 0 0 80px rgba(0,0,0,0.6)`,
      }}
    >
      {/* Radar sweep */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `conic-gradient(from ${sweepAngle - 70}deg at ${center.x}px ${center.y}px, rgba(92,225,242,0) 0deg, rgba(92,225,242,0.02) 40deg, rgba(92,225,242,0.11) 69deg, rgba(92,225,242,0) 70deg, rgba(92,225,242,0) 360deg)`,
        }}
      />
      {/* Runway end idents. Active end first; others are skipped where they would collide. */}
      {labels.map((l) => (
        <div
          key={l.key}
          style={{
            position: "absolute",
            left: l.x,
            top: l.y,
            translate: "-50% -50%",
            fontFamily: MONO,
            fontWeight: 700,
            fontSize: l.active ? 34 : 22,
            color: l.active ? C.scopeDeep : C.dim,
            background: l.active ? C.atc : "transparent",
            padding: l.active ? "2px 12px" : 0,
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          {l.ident}
        </div>
      ))}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {gridX.map((x) => (
          <line key={`gx${x}`} x1={x} x2={x} y1={0} y2={height} stroke={C.grid} strokeWidth={1} opacity={0.45} />
        ))}
        {gridY.map((y) => (
          <line key={`gy${y}`} x1={0} x2={width} y1={y} y2={y} stroke={C.grid} strokeWidth={1} opacity={0.45} />
        ))}
        {ringRadii.map((r) => (
          <circle key={r} cx={center.x} cy={center.y} r={r} fill="none" stroke={C.gridBright} strokeWidth={1.5} opacity={0.55} strokeDasharray="2 10" />
        ))}

        {/* Approach course on the extended centerline */}
        <line x1={crsA.x} y1={crsA.y} x2={crsB.x} y2={crsB.y} stroke={C.route} strokeWidth={2} strokeDasharray="14 12" opacity={0.35} />

        {/* Runways */}
        {story.runways.map((r) => {
          const a = project({ x: r.le.x, y: r.le.y });
          const b = project({ x: r.he.x, y: r.he.y });
          const isActive = r.name === activeRunwayName;
          const w = Math.max(10, r.width * cam.scale);
          return (
            <g key={r.name}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isActive ? "#C9D6DE" : C.runway} strokeOpacity={isActive ? 0.95 : 0.55} strokeWidth={w} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={C.scope} strokeOpacity={0.8} strokeWidth={Math.max(1.5, w * 0.12)} strokeDasharray="10 10" />
            </g>
          );
        })}

        {/* Flown track as radar history dots */}
        {history.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={4.5 - i * 0.2} fill={C.pilot} opacity={0.75 - i * 0.05} />
        ))}

        {/* Active leg ahead */}
        {ahead.length > 1 ? (
          <polyline points={toPoints(ahead)} fill="none" stroke={C.route} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
        ) : null}

        {acScreen && aircraft ? (
          <g>
            <line x1={acScreen.x + 18 * leaderDx} y1={acScreen.y + 18 * leaderDy} x2={acScreen.x + 56 * leaderDx} y2={acScreen.y + 56 * leaderDy} stroke={C.text} strokeWidth={2} opacity={0.6} />
            <g transform={`translate(${acScreen.x} ${acScreen.y}) rotate(${aircraft.heading}) scale(${onGround ? 1.05 : 1.25})`} filter="url(#glow)">
              <path d={AIRCRAFT_PATH} fill={C.text} stroke={C.pilot} strokeWidth={1.5} />
            </g>
          </g>
        ) : null}
      </svg>

      {acScreen && aircraft ? (
        <div
          style={{
            position: "absolute",
            left: flipX ? acScreen.x - 60 - blockW : acScreen.x + 60,
            top: flipY ? acScreen.y + 52 : acScreen.y - 112,
            width: blockW,
            textAlign: flipX ? "right" : "left",
            fontFamily: MONO,
            fontSize: 28,
            lineHeight: 1.2,
            color: C.text,
            whiteSpace: "nowrap",
            textShadow: "0 0 8px rgba(0,0,0,0.9)",
          }}
        >
          <div style={{ fontWeight: 700 }}>{callsign}</div>
          <div style={{ color: aircraft.phase === "go-around" ? C.warning : C.route }}>
            {phaseLabel(aircraft.phase, runwayNow)}
          </div>
        </div>
      ) : null}

      {/* Nav-display annunciations */}
      <div
        style={{
          position: "absolute",
          left: 28,
          top: 22,
          fontFamily: MONO,
          fontSize: 24,
          color: C.dim,
          lineHeight: 1.3,
        }}
      >
        <div style={{ color: C.text, fontFamily: FONT, fontWeight: 700, fontSize: 30 }}>
          {story.airportCode} {runwayNow}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 26,
          top: 18,
          width: 52,
          height: 70,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 24,
          color: C.dim,
        }}
      >
        <svg width={24} height={30} viewBox="0 0 24 30">
          <path d="M12 0 L22 28 L12 21 L2 28 Z" fill="none" stroke={C.dim} strokeWidth={2.5} strokeLinejoin="round" />
        </svg>
        N
      </div>
    </div>
  );
};
