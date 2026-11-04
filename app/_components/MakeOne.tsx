"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { DemoAirport, DiscoverResult, ProgressEvent, StageName, StorySummary } from "../../server/demo";
import { airportTimeZone } from "../../src/lib/timeline";
import type { RenderProps } from "../../src/types";
import { formatDuration, formatUsd, formatWhen, timeAgo } from "../_lib/format";
import { refreshBudget } from "./BudgetPill";
import { DownloadMp4 } from "./DownloadMp4";
import { PhonePlayer } from "./PhonePlayer";
import styles from "./MakeOne.module.css";

type Candidate = DiscoverResult["candidates"][number];

const STAGES: { id: StageName; label: string; hint: string }[] = [
  { id: "collect", label: "Pulling radio transmissions", hint: "Every transmission for this flight, from 10 min before to 15 min after." },
  { id: "clean", label: "Cleaning & deduplicating", hint: "The same call is often heard on two frequencies." },
  { id: "storyboard", label: "Claude writes the storyboard", hint: "The longest step, usually about a minute." },
  { id: "audio", label: "Mixing the radio audio", hint: "Downloading each clip and stitching the track." },
  { id: "publish", label: "Publishing", hint: "Uploading the audio and the video's data." },
];

type StageState = { status: "pending" | "active" | "done"; detail?: string; startedAt?: number; endedAt?: number };

type Discover =
  | { status: "idle" }
  | { status: "loading"; airport: string; startedAt: number }
  | { status: "ready"; data: DiscoverResult }
  | { status: "error"; airport: string; message: string; busy: boolean };

type Build = {
  eventId: number;
  airport: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  stages: Record<StageName, StageState>;
  /** "lost": the progress stream dropped. The server still finishes the build. */
  status: "running" | "done" | "error" | "lost";
  error?: string;
  /** True when the server already had this video and returned it at once. */
  instant?: boolean;
  story?: StorySummary;
  props?: RenderProps;
};

const freshStages = (): Record<StageName, StageState> =>
  Object.fromEntries(STAGES.map((s) => [s.id, { status: "pending" }])) as Record<StageName, StageState>;

/** Seconds since `since`, ticking once a second while `since` is set. */
function useElapsed(since: number | null, until?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null || until != null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since, until]);
  if (since == null) return 0;
  return Math.max(0, Math.floor(((until ?? now) - since) / 1000));
}

const resultsSummary = (data: DiscoverResult): string =>
  data.candidates.length === 0
    ? `Nothing notable heard at ${data.airport} in the last 24 hours.`
    : `${data.candidates.length} moment${data.candidates.length === 1 ? "" : "s"} at ${data.airport}`;

async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) return "The server refused that request. Reload the page and try again.";
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* not JSON */
  }
  return `The server answered ${res.status}.`;
}

export function MakeOne({ builtIds }: { builtIds: string[] }) {
  const router = useRouter();
  const [airports, setAirports] = useState<DemoAirport[] | null>(null);
  const [airportsError, setAirportsError] = useState<string | null>(null);
  const [discover, setDiscover] = useState<Discover>({ status: "idle" });
  const [build, setBuild] = useState<Build | null>(null);
  const [built, setBuilt] = useState<Set<string>>(() => new Set(builtIds));
  const discoverAbort = useRef<AbortController | null>(null);
  // Set before the first await: a double-click lands before React re-renders the button as disabled.
  const discoverInFlight = useRef(false);
  const buildInFlight = useRef(false);
  const mounted = useRef(false);
  const buildHeading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => setBuilt((prev) => new Set([...prev, ...builtIds])), [builtIds]);

  const loadAirports = useCallback(async () => {
    setAirportsError(null);
    try {
      const res = await fetch("/api/airports");
      if (!res.ok) throw new Error(await errorMessage(res));
      setAirports((await res.json()) as DemoAirport[]);
    } catch (err) {
      setAirportsError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadAirports();
    return () => {
      mounted.current = false;
      // A running build is left alone on purpose: it is paid work and the server finishes it either way.
      discoverAbort.current?.abort();
    };
  }, [loadAirports]);

  /** Never called on load: a cache miss costs real credits, so only an explicit click runs it. */
  const runDiscover = async (airport: string, refresh = false) => {
    if (discoverInFlight.current) return;
    discoverInFlight.current = true;
    const ctrl = new AbortController();
    discoverAbort.current = ctrl;
    setDiscover({ status: "loading", airport, startedAt: Date.now() });
    try {
      const qs = new URLSearchParams({ airport });
      if (refresh) qs.set("refresh", "1");
      const res = await fetch(`/api/discover?${qs}`, { signal: ctrl.signal, cache: "no-store" });
      if (!res.ok) {
        setDiscover({ status: "error", airport, message: await errorMessage(res), busy: res.status === 429 });
      } else {
        setDiscover({ status: "ready", data: (await res.json()) as DiscoverResult });
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setDiscover({
        status: "error",
        airport,
        busy: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      discoverInFlight.current = false;
      refreshBudget();
    }
  };

  const update = (fn: (b: Build) => Build) => setBuild((b) => (b ? fn(b) : b));

  const handleEvent = (e: ProgressEvent) => {
    const now = Date.now();
    if (e.type === "stage") {
      update((b) => {
        const stages = { ...b.stages };
        const prev = stages[e.stage];
        stages[e.stage] =
          e.status === "start"
            ? { status: "active", startedAt: now }
            : { ...prev, status: "done", endedAt: now, detail: e.detail ?? prev.detail };
        return { ...b, stages };
      });
    } else if (e.type === "done") {
      update((b) => {
        const instant = Object.values(b.stages).every((s) => s.status === "pending");
        const stages = instant
          ? (Object.fromEntries(STAGES.map((s) => [s.id, { status: "done" }])) as Record<StageName, StageState>)
          : b.stages;
        return { ...b, stages, status: "done", endedAt: now, instant, story: e.story, props: e.props };
      });
      setBuilt((prev) => new Set([...prev, e.story.eventId]));
    } else {
      update((b) => ({ ...b, status: "error", endedAt: now, error: e.message }));
    }
  };

  const startBuild = async (c: Candidate, airport: string) => {
    if (buildInFlight.current) return;
    buildInFlight.current = true;
    setBuild({
      eventId: c.event_id,
      airport,
      label: c.summary,
      startedAt: Date.now(),
      stages: freshStages(),
      status: "running",
    });
    requestAnimationFrame(() => {
      buildHeading.current?.focus({ preventScroll: true });
      buildHeading.current?.scrollIntoView({ block: "start" });
    });

    let streaming = false;
    let finished = false;
    let instant = false;
    try {
      // No abort signal: leaving the page must not cancel a build.
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: c.event_id }),
      });
      if (!res.ok || !res.body) throw new Error(await errorMessage(res));
      streaming = true;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawStage = false;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as ProgressEvent;
        if (event.type === "stage") sawStage = true;
        if (event.type === "done") instant = !sawStage;
        if (event.type !== "stage") finished = true;
        handleEvent(event);
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          consume(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      consume(buffer + decoder.decode());
      if (!finished) throw new Error("The connection closed before the video was finished.");
    } catch (err) {
      if (finished) return;
      if (streaming) update((b) => ({ ...b, status: "lost", endedAt: Date.now() }));
      else handleEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      buildInFlight.current = false;
      refreshBudget();
      // A newly built video joins the gallery above.
      if (mounted.current && finished && !instant) router.refresh();
    }
  };

  const selected =
    discover.status === "loading" || discover.status === "error"
      ? discover.airport
      : discover.status === "ready"
        ? discover.data.airport
        : null;
  const building = build?.status === "running";
  const discoverStatus =
    discover.status === "loading"
      ? `Searching the last 24 hours of radio at ${discover.airport}…`
      : discover.status === "ready"
        ? resultsSummary(discover.data)
        : discover.status === "error"
          ? discover.busy
            ? discover.message
            : `Couldn’t search ${discover.airport} right now: ${discover.message}`
          : "";

  return (
    <section id="make" className={styles.section} aria-labelledby="make-heading">
      <div className={styles.intro}>
        <h2 id="make-heading" className={styles.heading}>
          Make one now
        </h2>
        <p className={styles.lede}>
          Pick an airport. The app searches its last 24 hours of radio for go-arounds, emergencies and TCAS alerts; choose
          one and watch the video get built, live.
        </p>
      </div>

      <div className={styles.airports} role="group" aria-label="Airports">
        {airports === null && !airportsError ? <p className={styles.muted}>Loading airports…</p> : null}
        {airportsError ? (
          <p className="notice" data-tone="error">
            Couldn’t load the airport list: {airportsError}{" "}
            <button type="button" className="link-quiet" onClick={() => void loadAirports()}>
              Try again
            </button>
          </p>
        ) : null}
        {airports?.map((a) => (
          <button
            key={a.code}
            type="button"
            className={styles.chip}
            aria-pressed={selected === a.code}
            title={a.name}
            disabled={discover.status === "loading" && discover.airport !== a.code}
            onClick={() => {
              if (selected === a.code && discover.status !== "error") return;
              void runDiscover(a.code);
            }}
          >
            {a.code}
          </button>
        ))}
      </div>

      <p role="status" aria-live="polite" className="visually-hidden">
        {discoverStatus}
      </p>

      <div className={styles.results}>
        {discover.status === "loading" ? <Searching airport={discover.airport} startedAt={discover.startedAt} /> : null}

        {discover.status === "error" ? (
          <div className="notice" data-tone={discover.busy ? undefined : "error"}>
            <p>{discoverStatus}</p>
            <p style={{ marginTop: "0.5rem", color: "var(--dim)" }}>
              {discover.busy ? null : "The videos in the gallery still play. "}
              <button type="button" className="link-quiet" onClick={() => void runDiscover(discover.airport)}>
                Try again
              </button>
            </p>
          </div>
        ) : null}

        {discover.status === "ready" ? (
          <Candidates
            data={discover.data}
            built={built}
            buildingId={building ? build?.eventId : undefined}
            disabled={building}
            onBuild={(c) => void startBuild(c, discover.data.airport)}
            onRefresh={() => void runDiscover(discover.data.airport, true)}
          />
        ) : null}
      </div>

      {build ? <BuildPanel build={build} headingRef={buildHeading} /> : null}
    </section>
  );
}

function Searching({ airport, startedAt }: { airport: string; startedAt: number }) {
  const sec = useElapsed(startedAt);
  return (
    <div className={styles.searching}>
      <span className={styles.sweep} aria-hidden="true" />
      <div>
        <p>Searching the last 24 hours of radio at {airport}…</p>
        <p className={styles.muted}>
          <span aria-hidden="true">
            <span className="mono">{formatDuration(sec)}</span> ·{" "}
          </span>
          a fresh search takes 15–40 seconds; results are kept for 6 hours.
        </p>
      </div>
    </div>
  );
}

function Candidates({
  data,
  built,
  buildingId,
  disabled,
  onBuild,
  onRefresh,
}: {
  data: DiscoverResult;
  built: Set<string>;
  buildingId?: number;
  disabled: boolean;
  onBuild: (c: Candidate) => void;
  onRefresh: () => void;
}) {
  const tz = airportTimeZone(data.airport);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div className={styles.resultsBar}>
        <p>{resultsSummary(data)}</p>
        <p className={styles.muted}>
          Results from {timeAgo(data.fetchedAt, now)} ·{" "}
          <button type="button" className="link-quiet" onClick={onRefresh} disabled={disabled}>
            Refresh (costs credits)
          </button>
        </p>
      </div>

      {data.candidates.length === 0 ? (
        <p className={styles.muted}>Try another airport: busy ones like JFK or ORD usually have something.</p>
      ) : (
        <ol className={styles.candidates}>
          {data.candidates.map((c) => {
            const ids = [c.event_id, ...(c.related_event_ids ?? [])].map(String);
            const builtId = ids.find((id) => built.has(id));
            return (
              <li key={c.event_id} className={styles.candidate}>
                <div className={styles.when}>
                  <span>{formatWhen(c.happened_at, tz)}</span>
                  <span className={styles.muted}>{timeAgo(c.happened_at, now)}</span>
                </div>
                <div className={styles.what}>
                  {c.callsigns.length ? <p className={styles.callsigns}>{c.callsigns.join(", ")}</p> : null}
                  <p>{c.summary}</p>
                  <p className={styles.score}>
                    score {c.score.toFixed(1)} · {c.evidence} transmission{c.evidence === 1 ? "" : "s"} of evidence
                  </p>
                </div>
                <div className={styles.action}>
                  {builtId ? (
                    <Link className="btn" href={`/watch/${builtId}`}>
                      Watch video
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={disabled}
                      onClick={() => onBuild(c)}
                      aria-describedby={`cand-${c.event_id}`}
                    >
                      {buildingId === c.event_id ? "Building…" : "Build video"}
                    </button>
                  )}
                  <span id={`cand-${c.event_id}`} className="visually-hidden">
                    {c.summary}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function BuildPanel({ build, headingRef }: { build: Build; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const total = useElapsed(build.startedAt, build.endedAt);
  const heading =
    build.status === "done"
      ? build.instant
        ? "Already built: served from the gallery"
        : "Your video is ready"
      : build.status === "error"
        ? "The build stopped"
        : build.status === "lost"
          ? "Lost the connection to the build"
          : "Building your video";
  // The latest step reached, so the line doesn't blank out between one step ending and the next starting.
  const step = STAGES.map((s) => build.stages[s.id].status !== "pending").lastIndexOf(true);
  // "error" and "lost" announce themselves through role="alert" below.
  const statusLine =
    build.status === "done"
      ? heading
      : build.status !== "running"
        ? ""
        : step < 0
          ? "Starting the build"
          : `Step ${step + 1} of ${STAGES.length}: ${STAGES[step].label}`;

  return (
    <div className={styles.build} data-status={build.status}>
      <div className={styles.buildMain}>
        <h3 ref={headingRef} tabIndex={-1} className={styles.buildHeading}>
          {heading}
        </h3>
        <p className={styles.buildLabel}>{build.label}</p>
        <p role="status" aria-live="polite" className="visually-hidden">
          {statusLine}
        </p>
        <p className={styles.muted}>
          <span className="mono">{formatDuration(total)}</span>{" "}
          {build.status === "running"
            ? "elapsed · a fresh build takes 1–2 minutes. It keeps going if you leave this page."
            : build.status === "lost"
              ? "so far"
              : "total"}
        </p>

        <ol className={styles.route} aria-label="Build steps">
          {STAGES.map((s) => {
            const st = build.stages[s.id];
            const took = st.startedAt && st.endedAt ? Math.round((st.endedAt - st.startedAt) / 1000) : null;
            const failed = build.status === "error" && st.status === "active";
            return (
              <li key={s.id} className={styles.leg} data-state={failed ? "failed" : st.status}>
                <span className={styles.waypoint} aria-hidden="true" />
                <div>
                  <p className={styles.legLabel}>
                    {s.label}
                    <span className="visually-hidden">
                      {failed ? " (stopped)" : st.status === "done" ? " (done)" : st.status === "active" ? " (in progress)" : ""}
                    </span>
                    {took != null && !build.instant ? <span className={styles.took}>{took} s</span> : null}
                  </p>
                  {st.detail ? (
                    <p className={styles.legDetail}>{st.detail}</p>
                  ) : st.status === "active" ? (
                    <p className={styles.legHint}>{s.hint}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {build.status === "error" ? (
          <div className="notice" data-tone="error" role="alert">
            <p>{build.error}</p>
            <p style={{ marginTop: "0.5rem", color: "var(--dim)" }}>The gallery videos still play. Any data already pulled is kept, so a retry costs less.</p>
          </div>
        ) : null}

        {build.status === "lost" ? (
          <div className="notice" role="alert">
            <p>The build is still running on the server. The video joins the gallery when it’s done, usually within a couple of minutes.</p>
          </div>
        ) : null}

        {build.status === "done" && build.story ? (
          <>
            <p className={styles.doneStats}>
              {build.story.transmissionsReviewed} transmissions reviewed · {build.story.clips} clips ·{" "}
              {formatUsd(build.story.costUsd)} in API credits
            </p>
            <div className={styles.doneActions}>
              <Link className="btn" href={`/watch/${build.story.eventId}`}>
                Open the full page with the transcript
              </Link>
              <DownloadMp4 eventId={build.story.eventId} />
            </div>
          </>
        ) : null}
      </div>

      {build.status === "done" && build.props ? (
        <div className={styles.buildPlayer}>
          <PhonePlayer story={build.props} initialFrame={Math.round(build.props.introSec * 30 * 0.8)} />
        </div>
      ) : null}
    </div>
  );
}
