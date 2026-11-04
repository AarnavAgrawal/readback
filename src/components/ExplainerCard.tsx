import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import type { Explainer } from "../types";

type Props = { explainer: Explainer; width: number };

/** Glass card that explains one concept; rendered only inside its time range. */
export const ExplainerCard: React.FC<Props> = ({ explainer, width }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = Math.round(explainer.startSec * fps);
  const end = Math.round(explainer.endSec * fps);
  if (frame < start || frame >= end) {
    return null;
  }
  return (
    <div
      style={{
        width,
        boxSizing: "border-box",
        padding: "30px 36px 34px",
        borderRadius: 24,
        background: "rgba(6,24,38,0.93)",
        boxShadow: `inset 0 0 0 2px ${C.info}55, 0 20px 60px rgba(0,0,0,0.55)`,
        borderLeft: `10px solid ${C.info}`,
        opacity: interpolate(frame, [start, start + 8, end - 8, end], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: interpolate(frame, [start, start + 14], ["0px 50px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 52, color: C.info, marginBottom: 12 }}>
        {explainer.heading}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 38, lineHeight: 1.38, color: C.text }}>
        {explainer.body}
      </div>
    </div>
  );
};
