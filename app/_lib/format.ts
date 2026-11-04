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

/** "claude-opus-5-5" → "Claude Opus 5.5"; anything else is returned as-is. */
export function modelName(id: string): string {
  // Minor version is 1–2 digits, so a date suffix (-20250514) isn't read as one.
  const m = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2})(?!\d))?/i.exec(id ?? "");
  if (!m) return id || "Claude";
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `Claude ${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
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
