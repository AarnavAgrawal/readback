import Link from "next/link";
import styles from "./page.module.css";

export default function NotFound() {
  return (
    <div className={styles.notFound}>
      <h1 className={styles.notFoundTitle}>Say again?</h1>
      <p className={styles.notFoundText}>That page doesn’t exist, or the video hasn’t been made yet.</p>
      <p>
        <Link className="btn" href="/">
          Back to the videos
        </Link>
      </p>
    </div>
  );
}
