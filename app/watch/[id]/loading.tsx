import styles from "./watch.module.css";

export default function Loading() {
  return (
    <div className={styles.page} role="status" aria-label="Loading the video">
      <div className={styles.head}>
        <p className={styles.back}>&nbsp;</p>
        <span className={styles.ghost} style={{ width: "16rem" }} />
        <span className={`${styles.ghost} ${styles.ghostQuote}`} />
        <span className={styles.ghost} style={{ width: "min(100%, 26rem)", marginTop: "1rem" }} />
      </div>
      <div className={styles.video}>
        <div className={styles.videoFrame} />
      </div>
      <div className={styles.transcript}>
        <span className={`${styles.ghost} ${styles.ghostLine}`} />
        <span className={`${styles.ghost} ${styles.ghostLine}`} />
        <span className={`${styles.ghost} ${styles.ghostLine}`} />
      </div>
    </div>
  );
}
