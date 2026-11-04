import { connection } from "next/server";
import { getStoryProps, listStories, type StorySummary } from "../server/demo";
import type { RenderProps } from "../src/types";
import { Gallery } from "./_components/Gallery";
import { MakeOne } from "./_components/MakeOne";
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
      {stories.length > 0 ? (
        <Gallery stories={stories} lead={leadProps} />
      ) : (
        <section id="gallery" className={styles.empty} aria-labelledby="gallery-heading">
          <h1 id="gallery-heading" className={styles.emptyTitle}>
            Short videos of real air traffic control radio.
          </h1>
          {galleryError ? (
            <p className="notice" data-tone="error">
              The videos couldn’t be loaded. Reload the page to try again.
            </p>
          ) : (
            <p>No videos yet. Make the first one below.</p>
          )}
        </section>
      )}

      <MakeOne builtIds={stories.map((s) => s.eventId)} />
    </>
  );
}
