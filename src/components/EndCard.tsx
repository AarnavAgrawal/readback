import React, { useMemo } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { buildPhaseRuns, formatLocal } from "../lib/timeline";
import { C, FONT, MONO } from "../theme";
import type { FlightPhase, RenderProps } from "../types";

type Props = { story: RenderProps; timeZone: string };

const recapText = (phase: FlightPhase, runway: string, notes: string[]): string => {
  const extra = notes.filter((n) => !/GO.?AROUND/i.test(n)).map((n) => n.toLowerCase());
  switch (phase) {
    case "final":
      return `On final for ${runway}`;
    case "go-around":
      return extra.length > 0 ? `Go-around: ${extra.join(", ")}` : "Go-around";
    case "vectors":
      return "Vectored back around";
    case "landing":
      return `Cleared to land ${runway}`;
    case "taxi":
      return "Taxi to the gate";
    default:
      return phase;
  }
};

const PHASE_COLOR: Record<FlightPhase, string> = {
  final: C.route,
  "go-around": C.warning,
  vectors: C.atc,
  landing: C.go,
  taxi: C.pilot,
};

/** Closing card: the event as a real-time timeline. Frames are relative to the card's Sequence. */
export const EndCard: React.FC<Props> = ({ story, timeZone }) => {
  const frame = useCurrentFrame();

  const recap = useMemo(
    () =>
      buildPhaseRuns(story).map((run) => {
        const segs = run.segmentIndices.map((i) => story.segments[i]);
        const notes = segs.map((s) => s.note).filter((n): n is string => Boolean(n));
        return {
          phase: run.phase,
          time: formatLocal(segs[0].realTimeUtc, timeZone, false, false),
          text: recapText(run.phase, run.runway, notes),
        };
      }),
    [story, timeZone],
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(90% 60% at 50% 40%, ${C.panel} 0%, ${C.scope} 55%, ${C.scopeDeep} 100%)`,
        opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        padding: "190px 80px 0",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontFamily: MONO, fontSize: 34, color: C.dim, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: C.atc, fontWeight: 700 }}>{story.airportCode}</span>
        <span>{story.dateLine}</span>
      </div>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 80, lineHeight: 1.12, color: C.text, marginTop: 70, textWrap: "balance" }}>
        {story.title}
      </div>

      <div style={{ position: "relative", marginTop: 80 }}>
        <div style={{ position: "absolute", left: 13, top: 20, bottom: 20, width: 3, background: C.grid }} />
        {recap.map((r, i) => {
          const at = 10 + i * 6;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 34,
                padding: "16px 0",
                opacity: interpolate(frame, [at, at + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
                translate: interpolate(frame, [at, at + 12], ["24px 0px", "0px 0px"], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }),
              }}
            >
              <div style={{ width: 29, height: 29, borderRadius: 15, background: C.scope, boxShadow: `inset 0 0 0 6px ${PHASE_COLOR[r.phase]}`, flexShrink: 0 }} />
              <div style={{ fontFamily: MONO, fontSize: 32, color: C.dim, width: 200, flexShrink: 0 }}>{r.time}</div>
              <div style={{ fontFamily: FONT, fontSize: 44, color: C.text }}>{r.text}</div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          bottom: 250,
          fontFamily: FONT,
          fontSize: 40,
          color: C.dim,
          opacity: interpolate(frame, [24, 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ fontSize: 32 }}>Captions are verbatim radio transcripts.</div>
      </div>
    </div>
  );
};
