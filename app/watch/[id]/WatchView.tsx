"use client";

import type { PlayerRef } from "@remotion/player";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { StorySummary } from "../../../server/demo";
import { airportTimeZone, formatLocal } from "../../../src/lib/timeline";
import type { RenderProps } from "../../../src/types";
import { DownloadMp4 } from "../../_components/DownloadMp4";
import { PhonePlayer } from "../../_components/PhonePlayer";
import { formatDuration, formatUsd, plainDate, speakerName } from "../../_lib/format";
import styles from "./watch.module.css";

/** Matches STORY_FPS in src/StoryVideo (not imported here so the video code stays in the lazy Player chunk). */
const STORY_FPS = 30;

/** How long the transcript stays put after someone scrolls it by hand. */
const HANDS_OFF_MS = 4000;

export function WatchView({ story, summary }: { story: RenderProps; summary: StorySummary | null }) {
  const playerRef = useRef<PlayerRef | null>(null);
  const videoRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(-1);
  const [said, setSaid] = useState(0);
  const [playing, setPlaying] = useState(false);
  const activeRef = useRef(-1);
  const lastHandScroll = useRef(0);
  const forceFollow = useRef(false);
  const timeZone = story.timeZone ?? airportTimeZone(story.airportCode);
  const segments = story.segments;

  // Start frames of each beat, for highlighting the one being heard.
  const starts = useMemo(() => segments.map((s) => Math.round(s.startSec * STORY_FPS)), [segments]);
  const onFrame = useCallback(
    (frame: number) => {
      let idx = -1;
      for (let i = 0; i < starts.length; i++) if (frame >= starts[i]) idx = i;
      // Past the last beat's end (the end card): nothing is being heard.
      if (idx >= 0 && idx === starts.length - 1 && frame > segments[idx].endSec * STORY_FPS + STORY_FPS) idx = -1;
      activeRef.current = idx;
      setActive(idx);
      const sec = frame / STORY_FPS;
      setSaid(idx < 0 ? 0 : segments[idx].words.filter((w) => w.startSec <= sec).length);
    },
    [starts, segments],
  );

  const seekTo = (i: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(starts[i]);
    player.play();
    activeRef.current = i;
    setActive(i);
  };

  const onLineClick = (i: number, e: MouseEvent<HTMLButtonElement>) => {
    seekTo(i);
    // A mouse click shouldn't leave focus here, or Space would replay this line instead of pausing.
    if (e.detail > 0) e.currentTarget.blur();
  };

  // Space plays and pauses; the arrows move between lines, keeping whatever state playback is in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const player = playerRef.current;
      if (!player) return;

      if (e.key === " ") {
        if (target?.closest("a, button")) return; // those answer to Space themselves
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const step = e.key === "ArrowRight" ? 1 : -1;
        const next = Math.min(starts.length - 1, Math.max(0, activeRef.current + step));
        forceFollow.current = true;
        player.seekTo(starts[next]);
        activeRef.current = next;
        setActive(next);
        if (target?.closest("button[aria-current], button[data-line]")) lineRefs.current[next]?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [starts]);

  // Scrolling by hand wins: the transcript stops following for a few seconds.
  useEffect(() => {
    const note = () => {
      lastHandScroll.current = Date.now();
    };
    window.addEventListener("wheel", note, { passive: true });
    window.addEventListener("touchmove", note, { passive: true });
    return () => {
      window.removeEventListener("wheel", note);
      window.removeEventListener("touchmove", note);
    };
  }, []);

  // Keep the line being heard on screen, below the video when the video is pinned above the transcript.
  useEffect(() => {
    const line = active >= 0 ? lineRefs.current[active] : null;
    if (!line) return;
    const forced = forceFollow.current;
    forceFollow.current = false;
    if (!forced && (!playing || Date.now() - lastHandScroll.current < HANDS_OFF_MS)) return;

    const video = videoRef.current?.getBoundingClientRect();
    // On a phone the video pins to the top of the screen, so its height is what the transcript has to clear.
    const top = video && video.width >= window.innerWidth * 0.9 ? video.height : 0;
    const room = window.innerHeight - top;
    const box = line.getBoundingClientRect();
    if (box.top >= top + room * 0.08 && box.bottom <= top + room * 0.8) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: box.top - (top + room * 0.28), behavior: smooth ? "smooth" : "auto" });
  }, [active, playing]);

  const duration = summary?.durationSec ?? story.totalSec;
  const clips = summary?.clips ?? segments.length;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.back}>
          <Link href="/#gallery">All videos</Link>
        </p>
        <p className={styles.where}>
          <strong>{story.airportCode}</strong> {story.airportName}
        </p>
        <blockquote className={styles.quote}>
          <p>
            <span className={styles.openQuote} aria-hidden="true">
              “
            </span>
            {story.hook}
            <span aria-hidden="true">”</span>
          </p>
        </blockquote>
        <h1 className={styles.title} id="story-title">
          {story.title}
        </h1>
        <p className={styles.facts}>
          {plainDate(story.dateLine)}.{story.conditions ? ` ${story.conditions}.` : ""} {formatDuration(duration)} long.{" "}
          {summary
            ? `${clips} clips from ${summary.transmissionsReviewed} transmissions. Cost ${formatUsd(summary.costUsd)} to make.`
            : `${clips} clips.`}
        </p>
        <div className={styles.download}>
          <DownloadMp4 eventId={story.eventId} />
        </div>
      </header>

      <div className={styles.video} ref={videoRef}>
        <div className={styles.videoFrame}>
          <PhonePlayer
            story={story}
            playerRef={playerRef}
            onFrame={onFrame}
            onPlayingChange={setPlaying}
            spaceKeyToPlayOrPause={false}
            initialFrame={Math.round(story.introSec * STORY_FPS * 0.8)}
          />
        </div>
      </div>

      <section aria-labelledby="transcript-heading" className={styles.transcript}>
        <div className={styles.transcriptHead}>
          <h2 id="transcript-heading">What was said</h2>
          <p className={styles.hint}>
            Tap or click a line to jump to it.
            <span className={styles.keys}>
              {" "}
              <kbd>Space</kbd> plays and pauses. <kbd>←</kbd> and <kbd>→</kbd> move between lines.
            </span>
          </p>
        </div>
        <ol className={styles.lines}>
          {segments.map((s, i) => {
            const gap = story.timeJumps.find(
              (j) => j.endSec <= s.startSec + 0.5 && (i === 0 || j.startSec >= segments[i - 1].endSec - 0.5),
            );
            const current = active === i;
            return (
              <Fragment key={s.audioSampleId + i}>
                {gap ? <li className={styles.gap}>{gap.label}</li> : null}
                <li>
                  <button
                    type="button"
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    className={styles.line}
                    data-line=""
                    data-voice={s.role}
                    aria-current={current ? "true" : undefined}
                    onClick={(e) => onLineClick(i, e)}
                  >
                    <span className={styles.lineMeta}>
                      <span className={styles.speaker}>{speakerName(s.speakerLabel, story.airportCode)}</span>
                      <time dateTime={s.realTimeUtc} suppressHydrationWarning>
                        {formatLocal(s.realTimeUtc, timeZone, true)}
                      </time>
                      {s.note ? <span className={styles.note}>{s.note}</span> : null}
                    </span>
                    <span className={styles.text}>
                      {current
                        ? s.words.map((w, j) => (
                            <Fragment key={j}>
                              <span className={styles.word} data-said={j < said || undefined}>
                                {w.text}
                              </span>{" "}
                            </Fragment>
                          ))
                        : s.text}
                    </span>
                    <span className={styles.at}>
                      <span className="visually-hidden">Play from </span>
                      {formatDuration(s.startSec)}
                    </span>
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
