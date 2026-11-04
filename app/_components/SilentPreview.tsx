"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef } from "react";
import { STORY_FPS, StoryVideo, type StoryVideoProps } from "../../src/StoryVideo";
import type { RenderProps } from "../../src/types";

const bare = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The stretch of a story worth previewing: the line its quote comes from, plus a few seconds after it. */
function previewRange(story: RenderProps, totalFrames: number) {
  const hook = bare(story.hook);
  const beat =
    story.segments.find((s) => bare(s.text).includes(hook)) ?? story.segments.find((s) => s.note) ?? story.segments[0];
  if (!beat) return { from: 0, to: totalFrames - 1, poster: 0 };
  const from = Math.round(beat.startSec * STORY_FPS);
  const to = Math.max(from + 1, Math.min(totalFrames - 1, Math.round((beat.endSec + 3) * STORY_FPS)));
  // Partway through the line, so a paused preview shows the caption being spoken.
  const poster = Math.min(to, Math.round(((beat.startSec + beat.endSec) / 2) * STORY_FPS));
  return { from, to, poster };
}

/**
 * A muted, controls-free Player for moving through the gallery. It never loads
 * the audio file, and it plays only while `playing` and motion is welcome.
 */
export default function SilentPreview({ story, playing }: { story: RenderProps; playing: boolean }) {
  const ref = useRef<PlayerRef | null>(null);
  const durationInFrames = Math.max(1, Math.ceil(story.totalSec * STORY_FPS));
  const range = useMemo(() => previewRange(story, durationInFrames), [story, durationInFrames]);
  const inputProps = useMemo<StoryVideoProps>(() => ({ ...story, audioAvailable: false }), [story]);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const stillOnly = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (playing && !stillOnly) player.play();
    else player.pause();
  }, [playing, story.eventId]);

  return (
    <Player
      key={story.eventId}
      ref={ref}
      component={StoryVideo}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={1080}
      compositionHeight={1920}
      fps={STORY_FPS}
      initialFrame={range.poster}
      inFrame={range.from}
      outFrame={range.to}
      loop
      initiallyMuted
      controls={false}
      clickToPlay={false}
      spaceKeyToPlayOrPause={false}
      acknowledgeRemotionLicense
      style={{ width: "100%", height: "100%" }}
    />
  );
}
