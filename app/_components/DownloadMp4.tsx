"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RenderState =
  | { status: "none" }
  | { status: "rendering"; progress: number; stage: string }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

/** "lost": polling gave up. Unlike "error", the render itself may still be fine. */
type View = RenderState | { status: "lost"; message: string };

type Method = "GET" | "POST";

const POLL_MS = 3000;
const MAX_FAILURES = 5;

const isRenderState = (body: unknown): body is RenderState => {
  const b = body as Record<string, unknown> | null;
  switch (b?.status) {
    case "none":
      return true;
    case "rendering":
      return typeof b.progress === "number";
    case "done":
      return typeof b.url === "string";
    case "error":
      return typeof b.message === "string";
    default:
      return false;
  }
};

type Reply =
  | { failed: false; state: RenderState }
  | { failed: true; state: Extract<RenderState, { status: "error" }> };

/**
 * One call to the render API; never rejects. `failed` marks a request that went
 * wrong, as opposed to the server reporting that the render itself failed.
 */
async function callRender(eventId: string, method: Method, signal: AbortSignal): Promise<Reply> {
  const failure = (message: string): Reply => ({ failed: true, state: { status: "error", message } });

  let res: Response;
  try {
    res = await fetch(`/api/stories/${eventId}/render`, { method, cache: "no-store", signal });
  } catch {
    return failure("Could not reach the server.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const { message, error } = (body ?? {}) as { message?: unknown; error?: unknown };
    const text = [message, error].find((m) => typeof m === "string") as string | undefined;
    return failure(text ?? `The server answered ${res.status}.`);
  }
  return isRenderState(body) ? { state: body, failed: false } : failure("The server sent an unreadable answer.");
}

/**
 * "Download MP4": renders the story on the server the first time (a few
 * minutes), then downloads the finished file. The render keeps going if the
 * page is closed, and everyone shares the same file.
 */
export function DownloadMp4({ eventId }: { eventId: string }) {
  return <DownloadControl key={eventId} eventId={eventId} />;
}

function DownloadControl({ eventId }: { eventId: string }) {
  const [view, setView] = useState<View | null>(null);
  /** Bumped by every request and on unmount; a reply from an older generation is dropped. */
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const failures = useRef(0);

  const cancelPending = useCallback(() => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inFlight.current?.abort();
  }, []);

  /** The one scheduler: the first check, every poll and the POST all run here, so only one chain can exist. */
  const request = useCallback(
    async function tick(method: Method) {
      cancelPending();
      const mine = generation.current;
      const ctrl = new AbortController();
      inFlight.current = ctrl;

      const { failed, state } = await callRender(eventId, method, ctrl.signal);
      if (mine !== generation.current) return;

      const pollIn = (ms: number) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void tick("GET"), ms);
      };

      // A failed POST is shown at once: starting a render is the user's call, not a background retry.
      if (failed && method === "GET") {
        failures.current += 1;
        if (failures.current >= MAX_FAILURES) {
          setView({ status: "lost", message: `Couldn’t check on the MP4. ${state.message}` });
        } else {
          pollIn(POLL_MS * 2 ** (failures.current - 1));
        }
        return;
      }

      failures.current = 0;
      setView(state);
      if (state.status === "rendering") pollIn(POLL_MS);
    },
    [eventId, cancelPending],
  );

  useEffect(() => {
    void request("GET");
    return cancelPending;
  }, [request, cancelPending]);

  const start = () => {
    failures.current = 0;
    setView({ status: "rendering", progress: 0, stage: "starting" });
    void request("POST");
  };

  const recheck = () => {
    failures.current = 0;
    setView(null);
    void request("GET");
  };

  // Same size as the buttons below, so the page doesn't shift when the answer arrives.
  if (!view) {
    return (
      <button type="button" className="btn btn-primary" disabled>
        Checking for MP4…
      </button>
    );
  }

  if (view.status === "done") {
    // download=1 makes Blob send it as an attachment (the URL may already have it).
    const href = new URL(view.url);
    href.searchParams.set("download", "1");
    return (
      <a className="btn btn-primary" href={href.toString()} download={`readback-${eventId}.mp4`}>
        Download MP4
      </a>
    );
  }

  if (view.status === "rendering") {
    const pct = Math.round(view.progress * 100);
    return (
      <p role="status" aria-live="polite" style={{ margin: 0 }}>
        {pct > 0 ? `Rendering the MP4… ${pct}%` : "Starting the renderer… this takes a minute."} You can keep watching; the download
        appears here when it&apos;s ready.
      </p>
    );
  }

  return (
    <div>
      <button type="button" className="btn btn-primary" onClick={view.status === "lost" ? recheck : start}>
        {view.status === "none" ? "Render & download MP4" : "Try again"}
      </button>
      {view.status !== "none" ? (
        <p role="alert" style={{ margin: "8px 0 0" }}>
          {view.message}
        </p>
      ) : null}
    </div>
  );
}
