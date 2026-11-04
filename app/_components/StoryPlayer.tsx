"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { STORY_FPS, StoryVideo, type StoryVideoProps } from "../../src/StoryVideo";
import type { RenderProps } from "../../src/types";
import { absoluteUrl } from "../_lib/format";

export type StoryPlayerProps = {
  story: RenderProps;
  /** Optional handle for seeking from outside (e.g. the transcript list). */
  playerRef?: RefObject<PlayerRef | null>;
  /** Called with the current frame while playing or seeking. */
  onFrame?: (frame: number) => void;
  /** Frame shown before the first play. */
  initialFrame?: number;
};

/** Shown in place of the video if the composition crashes. Drawn at composition size (1080 wide), then scaled down. */
const renderCrash = () => (
  <div style={{ padding: 96, textAlign: "center", color: "#fff", fontSize: 52, lineHeight: 1.35 }}>
    <p style={{ margin: 0, fontWeight: 600 }}>This video can&apos;t be played right now.</p>
    <p style={{ margin: "32px 0 0", opacity: 0.75 }}>Reload the page to try again.</p>
  </div>
);

/** The Remotion Player for one story, filling its (9:16) parent. Client-only. */
export default function StoryPlayer({ story, playerRef, onFrame, initialFrame }: StoryPlayerProps) {
  const ownRef = useRef<PlayerRef | null>(null);
  const ref = playerRef ?? ownRef;

  const inputProps = useMemo<StoryVideoProps>(
    () => ({ ...story, audioSrc: absoluteUrl(story.audioSrc), audioAvailable: true }),
    [story],
  );
  const durationInFrames = Math.max(1, Math.ceil(story.totalSec * STORY_FPS));

  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const handler = (e: { detail: { frame: number } }) => onFrameRef.current?.(e.detail.frame);
    player.addEventListener("frameupdate", handler);
    player.addEventListener("seeked", handler);
    return () => {
      player.removeEventListener("frameupdate", handler);
      player.removeEventListener("seeked", handler);
    };
    // A new story remounts the Player (see key below), so the listeners must move to the new instance.
  }, [ref, story.eventId]);

  return (
    <Player
      key={story.eventId}
      ref={ref}
      component={StoryVideo}
      errorFallback={renderCrash}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={1080}
      compositionHeight={1920}
      fps={STORY_FPS}
      initialFrame={initialFrame ? Math.min(initialFrame, durationInFrames - 1) : undefined}
      controls
      clickToPlay
      doubleClickToFullscreen
      allowFullscreen
      acknowledgeRemotionLicense
      style={{ width: "100%", height: "100%" }}
    />
  );
}
