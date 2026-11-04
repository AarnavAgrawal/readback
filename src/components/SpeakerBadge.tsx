import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import {
  formatFrequency,
  formatLocal,
  formatUtc,
  latestSegmentIndex,
} from "../lib/timeline";
import { C, FONT, MONO, roleColor } from "../theme";
import type { Segment } from "../types";

type Props = {
  segments: Segment[];
  timeZone: string;
  width: number;
};

const TowerGlyph: React.FC<{ color: string }> = ({ color }) => (
  <svg width={40} height={48} viewBox="0 0 40 48">
    <path d="M6 4 H34 L30 18 H10 Z" fill="none" stroke={color} strokeWidth={3.5} strokeLinejoin="round" />
    <path d="M13 18 L15 44 H25 L27 18" fill="none" stroke={color} strokeWidth={3.5} strokeLinejoin="round" />
    <path d="M8 44 H32" stroke={color} strokeWidth={3.5} strokeLinecap="round" />
  </svg>
);

const CockpitGlyph: React.FC<{ color: string }> = ({ color }) => (
  <svg width={44} height={48} viewBox="-24 -26 48 52">
    <path
      d="M0,-24 C2.6,-24 3.4,-20 3.4,-14 L3.4,-5 L22,6 L22,10 L3.4,4 L3.2,15 L9,20 L9,23 L0,21 L-9,23 L-9,20 L-3.2,15 L-3.4,4 L-22,10 L-22,6 L-3.4,-5 L-3.4,-14 C-3.4,-20 -2.6,-24 0,-24 Z"
      fill="none"
      stroke={color}
      strokeWidth={3}
      strokeLinejoin="round"
    />
  </svg>
);

export const SpeakerBadge: React.FC<Props> = ({ segments, timeZone, width }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const idx = latestSegmentIndex(segments, t);
  if (idx < 0) {
    return null;
  }
  const seg = segments[idx];
  const color = roleColor(seg.role);
  const speaking = t < seg.endSec;
  const startFrame = Math.round(seg.startSec * fps);
  const endFrame = Math.round(seg.endSec * fps);

  return (
    <div
      style={{
        width,
        height: 132,
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "0 30px",
        boxSizing: "border-box",
        borderRadius: 22,
        background: "rgba(10,34,51,0.85)",
        boxShadow: `inset 0 0 0 2px ${C.grid}`,
        opacity: interpolate(frame, [endFrame, endFrame + 0.6 * fps], [1, 0.55], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: interpolate(frame, [startFrame, startFrame + 8], ["0px 18px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.out(Easing.cubic),
        }),
      }}
    >
      <div
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: speaking ? `${color}26` : "transparent",
          boxShadow: `0 0 0 3px ${speaking ? color : C.faint}`,
        }}
      >
        {seg.role === "controller" ? (
          <TowerGlyph color={speaking ? color : C.dim} />
        ) : (
          <CockpitGlyph color={speaking ? color : C.dim} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 46,
            color,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {seg.speakerLabel}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 30, color: C.text, marginTop: 4 }}>
          {formatFrequency(seg.frequency)}
          {seg.frequency ? <span style={{ color: C.dim }}> MHz</span> : null}
        </div>
      </div>
      <div style={{ textAlign: "right", fontFamily: MONO }}>
        <div style={{ fontSize: 34, color: C.text, fontWeight: 700 }}>
          {formatLocal(seg.realTimeUtc, timeZone)}
        </div>
        <div style={{ fontSize: 28, color: C.dim, marginTop: 4 }}>{formatUtc(seg.realTimeUtc)}</div>
      </div>
    </div>
  );
};
