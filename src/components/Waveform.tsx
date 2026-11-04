import React from "react";
import {
  createSmoothSvgPath,
  useWindowedAudioData,
  visualizeAudioWaveform,
} from "@remotion/media-utils";
import { random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { activeSegmentIndex, segmentWords } from "../lib/timeline";
import { C, roleColor } from "../theme";
import type { Segment } from "../types";

type ScopeProps = {
  values: number[];
  color: string;
  width: number;
  height: number;
  gain: number;
};

const SAMPLES = 128;

/** Oscilloscope trace on a faint graticule. */
const Scope: React.FC<ScopeProps> = ({ values, color, width, height, gain }) => {
  const mid = height / 2;
  const path =
    values.length > 1
      ? createSmoothSvgPath({
          points: values.map((y, i) => ({
            x: (i / (values.length - 1)) * width,
            y: mid + Math.max(-1, Math.min(1, y * gain)) * (height / 2 - 6),
          })),
        })
      : `M0 ${mid} L${width} ${mid}`;
  const ticks = Array.from({ length: 13 }, (_, i) => (i / 12) * width);
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <line x1={0} x2={width} y1={mid} y2={mid} stroke={C.grid} strokeWidth={2} />
      {ticks.map((x) => (
        <line key={x} x1={x} x2={x} y1={mid - 8} y2={mid + 8} stroke={C.grid} strokeWidth={2} />
      ))}
      <path d={path} fill="none" stroke={color} strokeWidth={8} opacity={0.18} strokeLinejoin="round" />
      <path d={path} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" />
    </svg>
  );
};

type Props = {
  segments: Segment[];
  width: number;
  height: number;
};

const activeColor = (segments: Segment[], t: number) => {
  const idx = activeSegmentIndex(segments, t);
  return idx >= 0 ? roleColor(segments[idx].role) : C.faint;
};

/** Real audio: the trace is the radio signal itself. */
export const AudioWaveform: React.FC<
  Props & { audioSrc: string; audioStartSec: number }
> = ({ segments, width, height, audioSrc, audioStartSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioFrame = Math.max(0, frame - Math.round(audioStartSec * fps));
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({
    src: /^https?:\/\//.test(audioSrc) ? audioSrc : staticFile(audioSrc),
    frame: audioFrame,
    fps,
    windowInSeconds: 30,
  });
  const color = activeColor(segments, frame / fps);
  const values =
    audioData && frame >= audioStartSec * fps
      ? visualizeAudioWaveform({
          fps,
          frame: audioFrame,
          audioData,
          numberOfSamples: SAMPLES,
          windowInSeconds: 0.1,
          dataOffsetInSeconds,
        })
      : [];
  return <Scope values={values} color={color} width={width} height={height} gain={2.5} />;
};

/** No audio file yet: drive a plausible trace from word timings so the layout still reads. */
export const SyntheticWaveform: React.FC<Props> = ({ segments, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const idx = activeSegmentIndex(segments, t);
  const color = activeColor(segments, t);
  let level = 0.02;
  if (idx >= 0) {
    const inWord = segmentWords(segments[idx]).some((w) => t >= w.startSec && t < w.endSec);
    level = inWord ? 0.75 : 0.2;
  }
  const values = Array.from({ length: SAMPLES }, (_, i) => {
    const envelope = Math.sin((i / (SAMPLES - 1)) * Math.PI);
    const carrier =
      Math.sin(i * 0.9 + frame * 1.7) * 0.5 +
      Math.sin(i * 0.37 - frame * 0.8) * 0.3 +
      (random(`w-${frame}-${i}`) - 0.5) * 0.6;
    return carrier * envelope * level;
  });
  return <Scope values={values} color={color} width={width} height={height} gain={1} />;
};
