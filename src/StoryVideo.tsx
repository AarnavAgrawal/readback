import React, { useMemo } from "react";
import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Sequence,
  getStaticFiles,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { AirportMap } from "./components/AirportMap";
import { CaptionTrack } from "./components/CaptionTrack";
import { EndCard } from "./components/EndCard";
import { ExplainerCard } from "./components/ExplainerCard";
import { SpeakerBadge } from "./components/SpeakerBadge";
import { Stamp } from "./components/Stamp";
import { TimeJumpCard } from "./components/TimeJumpCard";
import { TitleCard } from "./components/TitleCard";
import { AudioWaveform, SyntheticWaveform } from "./components/Waveform";
import { airportTimeZone, deriveCallsign, outroStartSec } from "./lib/timeline";
import { C, FONT, LAYOUT, MONO } from "./theme";
import type { RenderProps } from "./types";

export type StoryVideoProps = RenderProps & {
  /**
   * Set by calculateMetadata after checking that `audioSrc` exists in public/.
   * Pass it explicitly to skip the check.
   */
  audioAvailable?: boolean;
};

export const STORY_FPS = 30;

const isRemote = (src: string) => /^https?:\/\//.test(src);
const audioUrl = (src: string) => (isRemote(src) ? src : staticFile(src));

const audioExists = async (src: string, signal: AbortSignal): Promise<boolean> => {
  if (!src) return false;
  if (isRemote(src)) return true;
  const wanted = src.replace(/\\/g, "/").replace(/^\/+/, "");
  const files = getStaticFiles();
  if (files.length > 0) {
    return files.some((f) => f.name.replace(/\\/g, "/") === wanted);
  }
  // Outside Studio/render getStaticFiles() is empty; ask the server instead.
  try {
    const res = await fetch(staticFile(wanted), { method: "HEAD", signal });
    return res.ok;
  } catch {
    return false;
  }
};

export const calculateStoryMetadata: CalculateMetadataFunction<StoryVideoProps> = async ({
  props,
  abortSignal,
}) => {
  const audioAvailable = props.audioAvailable ?? (await audioExists(props.audioSrc, abortSignal));
  return {
    durationInFrames: Math.max(1, Math.ceil(props.totalSec * STORY_FPS)),
    fps: STORY_FPS,
    props: { ...props, audioAvailable },
    defaultOutName: `story-${props.eventId}`,
  };
};

/** Fades the live HUD in as the title card leaves. Isolated so only it re-renders per frame. */
const HudFade: React.FC<{ fromSec: number; children: React.ReactNode }> = ({ fromSec, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [(fromSec - 0.4) * fps, fromSec * fps], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const StoryVideo: React.FC<StoryVideoProps> = (story) => {
  const { fps, width } = useVideoConfig();
  const timeZone = story.timeZone ?? airportTimeZone(story.airportCode);
  const callsign = useMemo(
    () => story.callsign ?? deriveCallsign(story.segments),
    [story.callsign, story.segments],
  );
  const outroSec = outroStartSec(story);
  const innerW = width - LAYOUT.side * 2;

  const jumpBounds = useMemo(
    () =>
      story.timeJumps.map((j) => {
        const before = [...story.segments].reverse().find((s) => s.endSec <= j.startSec + 0.05);
        const after = story.segments.find((s) => s.startSec >= j.endSec - 0.05);
        return { from: before?.realTimeUtc ?? null, to: after?.realTimeUtc ?? null };
      }),
    [story.segments, story.timeJumps],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: C.scopeDeep, fontFamily: FONT }}>
      {story.audioAvailable ? (
        // story.wav spans the whole video timeline: t=0 in the file is frame 0.
        <Audio name="Radio audio" src={audioUrl(story.audioSrc)} />
      ) : null}

      <Sequence name="HUD" durationInFrames={Math.ceil((outroSec + 0.5) * fps)}>
        <HudFade fromSec={story.introSec}>
          <div
            style={{
              position: "absolute",
              left: LAYOUT.side + 6,
              right: LAYOUT.side,
              top: LAYOUT.headerTop,
            }}
          >
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 42, color: C.text }}>
              {story.airportName}
            </div>
            {story.conditions ? (
              <div style={{ fontFamily: MONO, fontSize: 28, color: C.pilot, marginTop: 8 }}>
                {story.conditions}
              </div>
            ) : null}
          </div>

          <div style={{ position: "absolute", left: LAYOUT.side, top: LAYOUT.mapTop }}>
            <AirportMap story={story} callsign={callsign} width={innerW} height={LAYOUT.mapHeight} />
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: LAYOUT.mapTop + 120,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Stamp segments={story.segments} />
          </div>

          {story.explainers.map((e, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: LAYOUT.side + 20,
                width: innerW - 40,
                top: LAYOUT.mapTop,
                height: LAYOUT.mapHeight - 24,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
              }}
            >
              <ExplainerCard explainer={e} width={innerW - 40} />
            </div>
          ))}

          <div style={{ position: "absolute", left: LAYOUT.side, top: LAYOUT.badgeTop }}>
            <SpeakerBadge segments={story.segments} timeZone={timeZone} width={innerW} />
          </div>

          <div style={{ position: "absolute", left: LAYOUT.side + 10, top: LAYOUT.captionTop }}>
            <CaptionTrack segments={story.segments} width={innerW - 20} />
          </div>

          <div style={{ position: "absolute", left: LAYOUT.side, top: LAYOUT.waveTop }}>
            {story.audioAvailable ? (
              <AudioWaveform
                segments={story.segments}
                width={innerW}
                height={LAYOUT.waveHeight}
                audioSrc={story.audioSrc}
                audioStartSec={0}
              />
            ) : (
              <SyntheticWaveform segments={story.segments} width={innerW} height={LAYOUT.waveHeight} />
            )}
          </div>

          {story.timeJumps.map((j, i) => (
            <TimeJumpCard key={i} jump={j} fromIso={jumpBounds[i].from} toIso={jumpBounds[i].to} timeZone={timeZone} />
          ))}
        </HudFade>
      </Sequence>

      <Sequence name="Title card" durationInFrames={Math.max(1, Math.round(story.introSec * fps))}>
        <TitleCard story={story} />
      </Sequence>

      <Sequence name="End card" from={Math.round(outroSec * fps)}>
        <EndCard story={story} timeZone={timeZone} />
      </Sequence>
    </AbsoluteFill>
  );
};
