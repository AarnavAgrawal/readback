import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { formatLocal } from "../lib/timeline";
import { C, FONT, MONO } from "../theme";
import type { TimeJump } from "../types";

type Props = {
  jump: TimeJump;
  /** Real UTC time just before / after the gap (ISO), if known. */
  fromIso: string | null;
  toIso: string | null;
  timeZone: string;
};

/** Full-screen interstitial for compressed real time. Each sweep of the hand is one real minute. */
export const TimeJumpCard: React.FC<Props> = ({ jump, fromIso, toIso, timeZone }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = Math.round(jump.startSec * fps);
  const end = Math.round(jump.endSec * fps);
  if (frame < start || frame >= end) {
    return null;
  }

  const fromMs = fromIso ? new Date(fromIso).getTime() : NaN;
  const toMs = toIso ? new Date(toIso).getTime() : NaN;
  const hasTimes = Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs;
  const minutes = hasTimes ? (toMs - fromMs) / 60000 : 6;
  const progress = interpolate(frame, [start + 6, end - 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const handAngle = progress * Math.max(1, minutes) * 360;
  const clockIso = hasTimes ? new Date(fromMs + (toMs - fromMs) * progress).toISOString() : null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 44,
        background: "rgba(3,16,27,0.94)",
        opacity: interpolate(frame, [start, start + 8, end - 8, end], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <svg width={300} height={300} viewBox="-150 -150 300 300">
        <circle r={136} fill="none" stroke={C.gridBright} strokeWidth={4} />
        {Array.from({ length: 60 }, (_, i) => {
          const major = i % 5 === 0;
          const a = (i / 60) * Math.PI * 2;
          const r1 = major ? 108 : 120;
          return (
            <line
              key={i}
              x1={Math.sin(a) * r1}
              y1={-Math.cos(a) * r1}
              x2={Math.sin(a) * 130}
              y2={-Math.cos(a) * 130}
              stroke={major ? C.text : C.faint}
              strokeWidth={major ? 5 : 2.5}
            />
          );
        })}
        {/* Swept arc behind the hand */}
        <circle
          r={70}
          fill="none"
          stroke={C.route}
          strokeOpacity={0.35}
          strokeWidth={140}
          pathLength={360}
          strokeDasharray={`${handAngle % 360} 360`}
          transform="rotate(-90)"
        />
        <line x1={0} y1={18} x2={0} y2={-118} stroke={C.route} strokeWidth={7} strokeLinecap="round" transform={`rotate(${handAngle})`} />
        <circle r={10} fill={C.text} />
      </svg>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 96, color: C.text, textAlign: "center", padding: "0 80px" }}>
        {jump.label}
      </div>
      {clockIso ? (
        <div style={{ fontFamily: MONO, fontSize: 44, color: C.dim }}>
          {formatLocal(clockIso, timeZone)}
        </div>
      ) : null}
    </div>
  );
};
