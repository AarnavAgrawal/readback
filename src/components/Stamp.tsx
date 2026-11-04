import React, { useMemo } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import type { Segment } from "../types";

type NoteRun = { note: string; startSec: number; endSec: number };

const WARNING = /GO.?AROUND|EMERGENCY|MAYDAY|PAN.?PAN|WAKE|WINDSHEAR|TCAS|MISSED|ABORT|REJECT/i;
const ALL_CLEAR = /CLEARED TO LAND|LANDED|WELCOME BACK|ON THE GROUND/i;

const noteColor = (note: string): string => {
  if (WARNING.test(note)) return C.warning;
  if (ALL_CLEAR.test(note)) return C.go;
  return C.atc;
};

/** Annunciator-style label for a segment's `note`, held across consecutive segments with the same note. */
export const Stamp: React.FC<{ segments: Segment[] }> = ({ segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const runs = useMemo(() => {
    const out: NoteRun[] = [];
    for (const s of segments) {
      if (!s.note) continue;
      const last = out[out.length - 1];
      if (last && last.note === s.note) {
        last.endSec = s.endSec;
      } else {
        out.push({ note: s.note, startSec: s.startSec, endSec: s.endSec });
      }
    }
    // A stamp is a beat, not a banner: at most ~2.8s, and never overlapping the next one.
    out.forEach((r, i) => {
      const next = out[i + 1];
      r.endSec = Math.min(r.endSec + 0.8, r.startSec + 2.8, next ? next.startSec : Infinity);
    });
    return out;
  }, [segments]);

  const run = runs.find((r) => t >= r.startSec && t < r.endSec);
  if (!run) {
    return null;
  }
  const color = noteColor(run.note);
  const start = Math.round(run.startSec * fps);
  const end = Math.round(run.endSec * fps);
  const local = frame - start;
  const slam = spring({ frame: local, fps, config: { damping: 14, stiffness: 220, mass: 0.7 } });
  // Two quick blinks, like a master-warning light, then steady.
  const blink = local < 0.5 * fps && Math.floor(local / 4) % 2 === 1 ? 0.35 : 1;

  return (
    <div
      style={{
        display: "inline-block",
        padding: "12px 30px",
        border: `6px solid ${color}`,
        borderRadius: 14,
        background: "rgba(3,16,27,0.82)",
        boxShadow: `0 0 34px ${color}66, inset 0 0 24px ${color}33`,
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: run.note.length > 12 ? 60 : 76,
        letterSpacing: "0.04em",
        color,
        whiteSpace: "nowrap",
        rotate: "-3deg",
        scale: interpolate(slam, [0, 1], [1.7, 1]),
        opacity:
          blink *
          interpolate(frame, [start, start + 3, end - 8, end], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
      }}
    >
      {run.note}
    </div>
  );
};
