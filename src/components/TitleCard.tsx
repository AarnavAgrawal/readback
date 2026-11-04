import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT, MONO } from "../theme";
import type { RenderProps } from "../types";

type Props = { story: RenderProps };

/** Scope rings centered behind the hook. */
const ScopeBackdrop: React.FC<{ sweepDeg: number }> = ({ sweepDeg }) => (
  <div style={{ position: "absolute", inset: 0 }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `conic-gradient(from ${sweepDeg - 70}deg at 540px 900px, rgba(92,225,242,0) 0deg, rgba(92,225,242,0.03) 40deg, rgba(92,225,242,0.1) 69deg, rgba(92,225,242,0) 70deg)`,
      }}
    />
    <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
      {[220, 440, 660, 880, 1100].map((r) => (
        <circle key={r} cx={540} cy={900} r={r} fill="none" stroke={C.grid} strokeWidth={2} strokeDasharray="3 12" />
      ))}
      <line x1={540} y1={0} x2={540} y2={1920} stroke={C.grid} strokeWidth={1.5} opacity={0.6} />
      <line x1={0} y1={900} x2={1080} y2={900} stroke={C.grid} strokeWidth={1.5} opacity={0.6} />
    </svg>
  </div>
);

export const TitleCard: React.FC<Props> = ({ story }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const introFrames = Math.max(1, Math.round(story.introSec * fps));
  const words = story.hook.split(/\s+/).filter(Boolean);
  const revealFrames = Math.min(introFrames * 0.45, 1.4 * fps);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(90% 60% at 50% 47%, ${C.panel} 0%, ${C.scope} 55%, ${C.scopeDeep} 100%)`,
        opacity: interpolate(frame, [introFrames - 10, introFrames], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <ScopeBackdrop sweepDeg={(frame / fps) * 90} />

      <div style={{ position: "absolute", left: 80, right: 80, top: 150, display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 34, color: C.dim }}>
        <span style={{ color: C.atc, fontWeight: 700 }}>{story.airportCode}</span>
        <span>{story.dateLine}</span>
      </div>

      <div style={{ position: "absolute", left: 80, right: 80, top: 560 }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 200, lineHeight: 0.6, color: C.atc, height: 90 }}>
          “
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 96,
            lineHeight: 1.16,
            color: C.text,
            textWrap: "balance",
          }}
        >
          {words.map((w, i) => {
            const at = (i / Math.max(1, words.length)) * revealFrames + 4;
            return (
              <span
                key={i}
                style={{
                  opacity: interpolate(frame, [at, at + 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                }}
              >
                {w}{" "}
              </span>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 56,
            fontFamily: FONT,
            fontSize: 46,
            lineHeight: 1.3,
            color: C.dim,
            opacity: interpolate(frame, [revealFrames, revealFrames + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            translate: interpolate(frame, [revealFrames, revealFrames + 14], ["0px 24px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          {story.title}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          bottom: 260,
          fontFamily: FONT,
          fontSize: 40,
          color: C.text,
          opacity: interpolate(frame, [revealFrames + 6, revealFrames + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div>{story.airportName}</div>
        {story.conditions ? (
          <div style={{ fontFamily: MONO, fontSize: 32, color: C.pilot, marginTop: 14 }}>{story.conditions}</div>
        ) : null}
      </div>
    </div>
  );
};
