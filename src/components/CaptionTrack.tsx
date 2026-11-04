import React, { useMemo } from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { latestSegmentIndex, segmentWords } from "../lib/timeline";
import { C, FONT, roleColor } from "../theme";
import type { Segment, Word } from "../types";

type Props = {
  segments: Segment[];
  width: number;
  fontSize?: number;
  maxLines?: number;
};

type Page = { lines: Word[][]; startSec: number };

/** Greedy line-wrap by estimated glyph width, then group lines into pages. */
const paginate = (words: Word[], maxChars: number, maxLines: number): Page[] => {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let count = 0;
  for (const w of words) {
    const add = (line.length > 0 ? 1 : 0) + w.text.length;
    if (line.length > 0 && count + add > maxChars) {
      lines.push(line);
      line = [];
      count = 0;
    }
    count += (line.length > 0 ? 1 : 0) + w.text.length;
    line.push(w);
  }
  if (line.length > 0) {
    lines.push(line);
  }
  const pages: Page[] = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    const chunk = lines.slice(i, i + maxLines);
    pages.push({ lines: chunk, startSec: chunk[0][0].startSec });
  }
  return pages;
};

export const CaptionTrack: React.FC<Props> = ({
  segments,
  width,
  fontSize = 68,
  maxLines = 3,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // B612 Bold averages ~0.5em per glyph in mixed case; 0.56 leaves margin for wide words and digits.
  const maxChars = Math.max(10, Math.floor(width / (fontSize * 0.56)));
  const paged = useMemo(
    () => segments.map((s) => paginate(segmentWords(s), maxChars, maxLines)),
    [segments, maxChars, maxLines],
  );

  const idx = latestSegmentIndex(segments, t);
  if (idx < 0) {
    return null;
  }
  const seg = segments[idx];
  const pages = paged[idx];
  if (pages.length === 0) {
    return null;
  }
  let pageIdx = 0;
  pages.forEach((p, i) => {
    if (p.startSec <= t) pageIdx = i;
  });
  const page = pages[pageIdx];
  const color = roleColor(seg.role);
  const pageStartFrame = Math.round(Math.max(seg.startSec, page.startSec) * fps);
  const endFrame = Math.round(seg.endSec * fps);
  // The current word holds until the next one starts, so the highlight never flickers off mid-phrase.
  const flat = page.lines.flat();
  let currentIdx = -1;
  if (t < seg.endSec) {
    flat.forEach((w, i) => {
      if (w.startSec <= t) currentIdx = i;
    });
  } else {
    currentIdx = flat.length;
  }
  let running = 0;

  return (
    <div
      style={{
        width,
        fontFamily: FONT,
        fontWeight: 700,
        fontSize,
        lineHeight: 1.3,
        opacity: interpolate(
          frame,
          [pageStartFrame, pageStartFrame + 5, endFrame + 0.8 * fps, endFrame + 1.1 * fps],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        ),
      }}
    >
      {page.lines.map((line, li) => (
        <div key={li} style={{ whiteSpace: "nowrap" }}>
          {line.map((w, wi) => {
            const flatIdx = running++;
            const isCurrent = flatIdx === currentIdx;
            const spoken = flatIdx < currentIdx;
            const wStart = Math.round(w.startSec * fps);
            return (
              <span
                key={wi}
                style={{
                  position: "relative",
                  display: "inline-block",
                  marginRight: "0.28em",
                  color: isCurrent ? color : spoken ? C.text : "rgba(230,240,244,0.28)",
                  translate: isCurrent
                    ? interpolate(frame, [wStart, wStart + 4], ["0px 6px", "0px 0px"], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      })
                    : "0px 0px",
                }}
              >
                {w.text}
                {isCurrent ? (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: "0.04em",
                      height: 6,
                      borderRadius: 3,
                      background: color,
                    }}
                  />
                ) : null}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
