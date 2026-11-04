/** Small display helpers shared by server and client components. */

/** 69.7 → "1:09" */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec)); // floor, like the Player's own clock
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 3.951 → "$3.95" */
export function formatUsd(usd: number): string {
  return `$${(Number.isFinite(usd) ? usd : 0).toFixed(2)}`;
}

/** "Nov 3, 2026 · 5:24 PM ET" → "Nov 3, 2026 at 5:24 PM ET" */
export function plainDate(dateLine: string): string {
  return dateLine.replace(/\s*·\s*/g, " at ");
}

/** "TURKISH 1 HEAVY" → "Turkish 1 Heavy"; the airport code and anything with a digit stay as they are. */
export function speakerName(label: string, airportCode: string): string {
  return label
    .split(/\s+/)
    .map((w) => (w === airportCode || /\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(" ");
}

/** "2 h ago", "just now", "3 days ago" relative to `now`. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.round((now - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "Nov 3, 9:58 PM PST" in the given IANA zone. */
export function formatWhen(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

/** Absolute URL for the Player: relative audio paths would otherwise be read as Remotion staticFile paths. */
export function absoluteUrl(src: string): string {
  if (!src || /^https?:\/\//.test(src) || typeof window === "undefined") return src;
  return new URL(src, window.location.origin).href;
}
