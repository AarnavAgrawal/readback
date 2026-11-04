import Link from "next/link";
import type { StorySummary } from "../../server/demo";
import { formatDuration, formatUsd, modelName } from "../_lib/format";
import styles from "./StoryStrip.module.css";

/** One story as a flight progress strip: callsign | title + hook | airport, date, length. */
export function StoryStrip({ story }: { story: StorySummary }) {
  return (
    <li className={styles.item}>
      <Link href={`/watch/${story.eventId}`} className={styles.strip} data-featured={story.featured || undefined}>
        <span className={styles.callsign}>
          <span className="visually-hidden">Flight </span>
          {story.callsign ?? story.airportCode}
        </span>

        <span className={styles.body}>
          <span className={styles.title}>{story.title}</span>
          <span className={styles.hook}>
            <span aria-hidden="true">“</span>
            {story.hook}
            <span aria-hidden="true">”</span>
          </span>
          <span className={styles.stats}>
            built from {story.transmissionsReviewed} transmissions · {story.clips} clips ·{" "}
            {formatUsd(story.costUsd)} in API credits · storyboard by{" "}
            <span title={story.storyboardBy} style={{ whiteSpace: "nowrap" }}>
              {modelName(story.storyboardBy)}
            </span>
          </span>
        </span>

        <span className={styles.meta}>
          <span className={styles.airport} title={story.airportName}>
            {story.airportCode}
          </span>
          <span className={styles.date}>{story.dateLine}</span>
          <span className={styles.duration}>
            <span className="visually-hidden">Length </span>
            {formatDuration(story.durationSec)}
          </span>
        </span>
      </Link>
    </li>
  );
}
