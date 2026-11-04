import Link from "next/link";
import { connection } from "next/server";
import { getStoryProps, listStories, type StorySummary } from "../server/demo";
import type { RenderProps } from "../src/types";
import { MakeOne } from "./_components/MakeOne";
import { PhonePlayer } from "./_components/PhonePlayer";
import { StoryStrip } from "./_components/StoryStrip";
import styles from "./page.module.css";

export default async function Home() {
  await connection(); // the gallery changes whenever a video is built

  let stories: StorySummary[] = [];
  let galleryError = false;
  try {
    stories = await listStories();
  } catch (err) {
    console.error("[home] could not load stories", err);
    galleryError = true;
  }

  const lead = stories[0];
  let leadProps: RenderProps | null = null;
  if (lead) {
    try {
      leadProps = await getStoryProps(lead.eventId);
    } catch (err) {
      console.error(`[home] could not load props for ${lead.eventId}`, err);
    }
  }

  return (
    <>
      <section className={`wrap ${styles.hero}`} aria-labelledby="hero-heading">
        <div className={styles.heroText}>
          <h1 id="hero-heading" className={styles.headline}>
            Real air traffic control radio, turned into a finished vertical video, automatically.
          </h1>
          <p className={styles.sub}>
            Built on the Enhanced Radar API. Every video uses the actual radio audio and the verbatim transcript; Claude
            writes the storyboard and Remotion draws it.
          </p>
          <div className={styles.ctas}>
            <a className="btn btn-primary" href="#make">
              Make one now
            </a>
            <a className="btn" href="#gallery">
              Watch the gallery
            </a>
          </div>
        </div>

        {lead && leadProps ? (
          <div className={styles.heroPlayer}>
            <div className={styles.scope} aria-hidden="true">
              <span className={styles.sweep} />
            </div>
            <PhonePlayer story={leadProps} initialFrame={Math.round(leadProps.introSec * 30 * 0.8)} />
            <p className={styles.caption}>
              <Link href={`/watch/${lead.eventId}`}>{lead.title}</Link>
              <span className={`mono ${styles.captionMeta}`}>
                {lead.airportCode} · {lead.dateLine}
              </span>
            </p>
          </div>
        ) : null}
      </section>

      <section id="gallery" className={`wrap ${styles.gallery}`} aria-labelledby="gallery-heading">
        <div className={styles.sectionHead}>
          <h2 id="gallery-heading" className={styles.h2}>
            Gallery
          </h2>
          <p className={styles.muted}>
            {stories.length > 0
              ? `${stories.length} video${stories.length === 1 ? "" : "s"}, each from one real moment on frequency.`
              : null}
          </p>
        </div>

        {galleryError ? (
          <p className="notice" data-tone="error">
            The gallery couldn’t be loaded just now. Reload the page to try again.
          </p>
        ) : stories.length === 0 ? (
          <p className="notice">No videos yet. Make the first one below.</p>
        ) : (
          <ol className={styles.strips}>
            {stories.map((s) => (
              <StoryStrip key={s.eventId} story={s} />
            ))}
          </ol>
        )}
      </section>

      <div className={`wrap ${styles.make}`}>
        <MakeOne builtIds={stories.map((s) => s.eventId)} />
      </div>
    </>
  );
}
