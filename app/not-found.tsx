import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap" style={{ display: "grid", gap: "1rem", paddingBlock: "clamp(3rem, 10vw, 7rem)", maxWidth: "44rem" }}>
      <p className="mono" style={{ color: "var(--atc)", fontWeight: 700 }}>
        Unable, say again?
      </p>
      <h1 style={{ fontSize: "var(--step-3)" }}>There’s nothing on this frequency.</h1>
      <p style={{ color: "var(--dim)" }}>The page or video you asked for doesn’t exist. It may not have been built yet.</p>
      <p>
        <Link className="btn" href="/">
          Go to the gallery
        </Link>
      </p>
    </div>
  );
}
