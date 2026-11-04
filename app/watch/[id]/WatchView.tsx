"use client";

import type { PlayerRef } from "@remotion/player";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { StorySummary } from "../../../server/demo";
import { airportTimeZone, formatLocal } from "../../../src/lib/timeline";
import type { RenderProps } from "../../../src/types";
import { DownloadMp4 } from "../../_components/DownloadMp4";
import { PhonePlayer } from "../../_components/PhonePlayer";
import { formatDuration, formatUsd, modelName } from "../../_lib/format";
import styles from "./watch.module.css";

/** Matches STORY_FPS in src/StoryVideo (not imported here so the video code stays in the lazy Player chunk). */
const STORY_FPS = 30;

export function WatchView({ story, summary }: { story: RenderProps; summary: StorySummary | null }) {
  const playerRef = useRef<PlayerRef | null>(null);
  const [active, setActive] = useState(-1);
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
      setActive(idx);
    },
    [starts, segments],
  );

  const seekTo = (i: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(starts[i]);
    player.play();
    setActive(i);
  };

  const duration = summary?.durationSec ?? story.totalSec;

  return (
    <div className={`wrap ${styles.page}`}>
      <p className={styles.back}>
        <Link href="/#gallery">Back to the gallery</Link>
      </p>

      <div className={styles.layout}>
        <div className={styles.playerCol}>
          <PhonePlayer
            story={story}
            playerRef={playerRef}
            onFrame={onFrame}
            initialFrame={Math.round(story.introSec * STORY_FPS * 0.8)}
          />
        </div>

        <article className={styles.panel} aria-labelledby="story-title">
          <header className={styles.header}>
            <p className={styles.where}>
              <span className={styles.code}>{story.airportCode}</span>
              <span>{story.airportName}</span>
            </p>
            <h1 id="story-title" className={styles.title}>
              {story.title}
            </h1>
            <p className={styles.date}>
              {story.dateLine}
              {story.conditions ? <span className={styles.conditions}> · {story.conditions}</span> : null}
            </p>
            <blockquote className={styles.hook}>
              <p>
                <span aria-hidden="true">“</span>
                {story.hook}
                <span aria-hidden="true">”</span>
              </p>
            </blockquote>
          </header>

          <dl className={styles.stats}>
            <div>
              <dt>Length</dt>
              <dd>{formatDuration(duration)}</dd>
            </div>
            {summary ? (
              <>
                <div>
                  <dt>Transmissions reviewed</dt>
                  <dd>{summary.transmissionsReviewed}</dd>
                </div>
                <div>
                  <dt>Clips in the video</dt>
                  <dd>{summary.clips}</dd>
                </div>
                <div>
                  <dt>API credits</dt>
                  <dd>{formatUsd(summary.costUsd)}</dd>
                </div>
                <div>
                  <dt>Storyboard</dt>
                  <dd className={styles.model} title={summary.storyboardBy}>{modelName(summary.storyboardBy)}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>Clips in the video</dt>
                <dd>{segments.length}</dd>
              </div>
            )}
          </dl>

          <DownloadMp4 eventId={story.eventId} />

          <section aria-labelledby="transcript-heading" className={styles.transcript}>
            <div className={styles.transcriptHead}>
              <h2 id="transcript-heading">What was said</h2>
              <p>Verbatim from Enhanced Radar. Select a line to jump to it.</p>
            </div>
            <ol className={styles.beats}>
              {segments.map((s, i) => (
                <li key={s.audioSampleId + i}>
                  <button
                    type="button"
                    className={styles.beat}
                    data-role={s.role}
                    aria-current={active === i ? "true" : undefined}
                    onClick={() => seekTo(i)}
                  >
                    <span className={styles.beatMeta}>
                      <span className={styles.speaker}>{s.speakerLabel}</span>
                      <time dateTime={s.realTimeUtc} suppressHydrationWarning>
                        {formatLocal(s.realTimeUtc, timeZone, true)}
                      </time>
                      {s.note ? <span className={styles.note}>{s.note}</span> : null}
                    </span>
                    <span className={styles.text}>{s.text}</span>
                    <span className={styles.at}>
                      <span className="visually-hidden">Play from </span>
                      {formatDuration(s.startSec)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </article>
      </div>
    </div>
  );
}
