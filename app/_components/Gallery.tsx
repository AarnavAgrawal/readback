"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StorySummary } from "../../server/demo";
import type { RenderProps } from "../../src/types";
import { formatDuration, formatUsd, plainDate } from "../_lib/format";
import styles from "./Gallery.module.css";

const SilentPreview = dynamic(() => import("./SilentPreview"), { ssr: false });

/** Long enough that sweeping the pointer down the list doesn't remount the Player for every row. */
const SETTLE_MS = 90;

/** The quotes, as a list you can run a pointer down. The video for whichever one you're on plays alongside, silently. */
export function Gallery({ stories, lead }: { stories: StorySummary[]; lead: RenderProps | null }) {
  const [selected, setSelected] = useState(stories[0].eventId);
  const [shown, setShown] = useState(stories[0].eventId);
  const [engaged, setEngaged] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, RenderProps>>(() => (lead ? { [lead.eventId]: lead } : {}));
  const requested = useRef(new Set(lead ? [lead.eventId] : []));
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (id: string) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    try {
      const res = await fetch(`/api/stories/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      const props = (await res.json()) as RenderProps;
      setLoaded((prev) => ({ ...prev, [id]: props }));
    } catch {
      requested.current.delete(id); // the quote stands in; moving onto the row again retries
    }
  }, []);

  // Each story's data is a few KB and free to read, so previews can be instant. Touch screens never hover.
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    const t = setTimeout(() => stories.forEach((s) => void load(s.eventId)), 500);
    return () => clearTimeout(t);
  }, [stories, load]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const select = (id: string) => {
    setSelected(id);
    setEngaged(true);
    void load(id);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => setShown(id), SETTLE_MS);
  };

  const story = stories.find((s) => s.eventId === selected) ?? stories[0];
  const preview = loaded[shown];

  return (
    <section id="gallery" className={styles.section} aria-labelledby="gallery-heading">
      <div className={styles.index}>
        <div className={styles.intro}>
          <h1 id="gallery-heading" className={styles.heading}>
            Short videos of real air traffic control radio. Open one to hear it.
          </h1>
        </div>

        <ol
          className={styles.rows}
          onPointerLeave={() => setEngaged(false)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setEngaged(false);
          }}
        >
          {stories.map((s) => (
            <li key={s.eventId}>
              <Link
                href={`/watch/${s.eventId}`}
                className={styles.row}
                data-selected={s.eventId === selected || undefined}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") select(s.eventId);
                }}
                onFocus={() => select(s.eventId)}
              >
                <span className={styles.code} title={s.airportName}>
                  {s.airportCode}
                </span>
                <span className={styles.quote}>{s.hook}</span>
                <span className={styles.title}>{s.title}</span>
                <span className={styles.facts}>
                  {plainDate(s.dateLine)}. {formatDuration(s.durationSec)} long, {s.clips} clips from {s.transmissionsReviewed}{" "}
                  transmissions. Cost {formatUsd(s.costUsd)} to make.
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>

      <aside className={styles.preview} aria-hidden="true">
        <div className={styles.previewSticky}>
          <Link href={`/watch/${story.eventId}`} className={styles.screen} tabIndex={-1}>
            {preview ? (
              <SilentPreview story={preview} playing={engaged} />
            ) : (
              <span className={styles.standIn}>{story.hook}</span>
            )}
          </Link>
          <p className={styles.previewNote}>Silent preview. Open it to hear the radio.</p>
        </div>
      </aside>
    </section>
  );
}
