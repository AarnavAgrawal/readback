"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { DemoAirport, DiscoverResult, ProgressEvent, StageName, StorySummary } from "../../server/demo";
import { airportTimeZone } from "../../src/lib/timeline";
import type { RenderProps } from "../../src/types";
import { formatDuration, formatUsd, formatWhen, timeAgo } from "../_lib/format";
import { DownloadMp4 } from "./DownloadMp4";
import { PhonePlayer } from "./PhonePlayer";
import styles from "./MakeOne.module.css";

type Candidate = DiscoverResult["candidates"][number];

const STAGES: { id: StageName; label: string; hint: string }[] = [
  { id: "collect", label: "Pulling the radio", hint: "Every call for this flight, from 10 minutes before to 15 after." },
  { id: "clean", label: "Cleaning up", hint: "The same call often turns up on two frequencies." },
  { id: "storyboard", label: "Writing the story", hint: "The longest step, usually about a minute." },
  { id: "audio", label: "Mixing the audio", hint: "Downloading each clip and stitching the track." },
  { id: "publish", label: "Publishing", hint: "Uploading the audio and the video." },
];

const DAY_MS = 24 * 3600 * 1000;

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
    ? `Nothing notable at ${data.airport} in the last 24 hours.`
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

/** Left and right arrows walk the sign, as they would a toolbar. Selecting still takes Enter or a click. */
function walkSign(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const signs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const at = signs.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  signs[(at + (e.key === "ArrowRight" ? 1 : signs.length - 1)) % signs.length].focus();
}

export function MakeOne({ builtIds }: { builtIds: string[] }) {
  const router = useRouter();
  const [airports, setAirports] = useState<DemoAirport[] | null>(null);
  const [airportsError, setAirportsError] = useState<string | null>(null);
  const [discover, setDiscover] = useState<Discover>({ status: "idle" });
  const [build, setBuild] = useState<Build | null>(null);
  const [built, setBuilt] = useState<Set<string>>(() => new Set(builtIds));
  const [pointedAt, setPointedAt] = useState<string | null>(null);
  const [lit, setLit] = useState<number | null>(null);
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

  /** Never called on load: a cache miss costs real money, so only an explicit click runs it. */
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
      ? `Searching the last 24 hours at ${discover.airport}`
      : discover.status === "ready"
        ? resultsSummary(discover.data)
        : discover.status === "error"
          ? discover.busy
            ? discover.message
            : `Couldn’t search ${discover.airport}: ${discover.message}`
          : "";

  const named = airports?.find((a) => a.code === (pointedAt ?? selected));

  return (
    <section id="make" className={styles.section} aria-labelledby="make-heading">
      <div className={styles.intro}>
        <h2 id="make-heading" className={styles.heading}>
          Make a new one
        </h2>
        <p className={styles.lede}>Pick an airport. We’ll search its last 24 hours of radio for go-arounds and emergencies.</p>
      </div>

      {airportsError ? (
        <p className="notice" data-tone="error">
          Couldn’t load the airports: {airportsError}{" "}
          <button type="button" className="link-quiet" onClick={() => void loadAirports()}>
            Try again
          </button>
        </p>
      ) : (
        <div
          className={styles.sign}
          role="group"
          aria-label="Airports"
          aria-busy={airports === null}
          onKeyDown={walkSign}
          onPointerLeave={() => setPointedAt(null)}
        >
          {airports === null
            ? Array.from({ length: 12 }, (_, i) => <span key={i} className={styles.signBlank} aria-hidden="true" />)
            : airports.map((a) => (
                <button
                  key={a.code}
                  type="button"
                  className={styles.panel}
                  aria-pressed={selected === a.code}
                  aria-label={`${a.code}, ${a.name}`}
                  disabled={discover.status === "loading" && discover.airport !== a.code}
                  onPointerEnter={() => setPointedAt(a.code)}
                  onFocus={() => setPointedAt(a.code)}
                  onBlur={() => setPointedAt(null)}
                  onClick={() => {
                    if (selected === a.code && discover.status !== "error") return;
                    void runDiscover(a.code);
                  }}
                >
                  {a.code}
                </button>
              ))}
        </div>
      )}

      <p className={styles.airportName} aria-hidden="true">
        {named?.name ?? " "}
      </p>

      <p role="status" aria-live="polite" className="visually-hidden">
        {discoverStatus}
      </p>

      <LastDay discover={discover} lit={lit} />

      <div className={styles.results}>
        {discover.status === "loading" ? <Searching airport={discover.airport} startedAt={discover.startedAt} /> : null}

        {discover.status === "error" ? (
          <div className="notice" data-tone={discover.busy ? undefined : "error"}>
            <p>{discoverStatus}</p>
            <p className={styles.noticeAction}>
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
            onLight={setLit}
            onBuild={(c) => void startBuild(c, discover.data.airport)}
            onRefresh={() => void runDiscover(discover.data.airport, true)}
          />
        ) : null}
      </div>

      {build ? <BuildPanel build={build} headingRef={buildHeading} /> : null}
    </section>
  );
}

/** The 24 hours being searched, as a line: a marker runs along it during a search and each moment lands on it. */
function LastDay({ discover, lit }: { discover: Discover; lit: number | null }) {
  const data = discover.status === "ready" ? discover.data : null;
  const end = data ? new Date(data.fetchedAt).getTime() : 0;
  const tz = data ? airportTimeZone(data.airport) : "UTC";
  return (
    <div className={styles.day} data-searching={discover.status === "loading" || undefined} aria-hidden="true">
      <div className={styles.dayLine}>
        {discover.status === "loading" ? <span className={styles.dayScan} /> : null}
        {data?.candidates.map((c) => {
          const left = 100 - ((end - new Date(c.happened_at).getTime()) / DAY_MS) * 100;
          return (
            <span
              key={c.event_id}
              className={styles.dayMark}
              data-lit={lit === c.event_id || undefined}
              style={{ left: `${Math.min(100, Math.max(0, left))}%` }}
            />
          );
        })}
      </div>
      <div className={styles.dayEnds}>
        <span>{data ? formatWhen(new Date(end - DAY_MS).toISOString(), tz) : "24 hours ago"}</span>
        <span>{data ? formatWhen(data.fetchedAt, tz) : "Now"}</span>
      </div>
    </div>
  );
}

function Searching({ airport, startedAt }: { airport: string; startedAt: number }) {
  const sec = useElapsed(startedAt);
  return (
    <div className={styles.searching}>
      <p className={styles.searchingLine}>Searching {airport}</p>
      <p className={styles.searchingNote}>
        <span className={styles.clock} aria-hidden="true">
          {formatDuration(sec)}
        </span>{" "}
        A fresh search takes 15 to 40 seconds.
      </p>
    </div>
  );
}

function Candidates({
  data,
  built,
  buildingId,
  disabled,
  onLight,
  onBuild,
  onRefresh,
}: {
  data: DiscoverResult;
  built: Set<string>;
  buildingId?: number;
  disabled: boolean;
  onLight: (eventId: number | null) => void;
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
        <p className={styles.resultsCount}>{resultsSummary(data)}</p>
        <p className={styles.resultsAge}>
          Searched {timeAgo(data.fetchedAt, now)}.{" "}
          <button type="button" className="link-quiet" onClick={onRefresh} disabled={disabled}>
            Search again
          </button>
        </p>
      </div>

      {data.candidates.length === 0 ? (
        <p className={styles.tryAnother}>Try another airport. The busiest ones usually have something.</p>
      ) : (
        <ol className={styles.candidates} onPointerLeave={() => onLight(null)}>
          {data.candidates.map((c) => {
            const ids = [c.event_id, ...(c.related_event_ids ?? [])].map(String);
            const builtId = ids.find((id) => built.has(id));
            return (
              <li
                key={c.event_id}
                className={styles.candidate}
                onPointerEnter={() => onLight(c.event_id)}
                onFocus={() => onLight(c.event_id)}
              >
                <p className={styles.when}>
                  {formatWhen(c.happened_at, tz)}
                  <span className={styles.ago}>{timeAgo(c.happened_at, now)}</span>
                </p>
                <div className={styles.what}>
                  {c.callsigns.length ? <p className={styles.callsigns}>{c.callsigns.join(", ")}</p> : null}
                  <p className={styles.summary}>{c.summary}</p>
                  <p className={styles.heard}>
                    Heard in {c.evidence} transmission{c.evidence === 1 ? "" : "s"}.
                  </p>
                </div>
                <div className={styles.action}>
                  {builtId ? (
                    <Link className="btn btn-quiet" href={`/watch/${builtId}`}>
                      Watch video
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="btn"
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

const plainDetail = (detail: string) => detail.replace(/\s*·\s*/g, ", ");

function BuildPanel({ build, headingRef }: { build: Build; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const total = useElapsed(build.startedAt, build.endedAt);
  const heading =
    build.status === "done"
      ? build.instant
        ? "Already made, so here it is"
        : "Your video is ready"
      : build.status === "error"
        ? "The build stopped"
        : build.status === "lost"
          ? "Lost the connection to the build"
          : "Building your video";
  // The latest step reached, so the line doesn't blank out between one step ending and the next starting.
  const step = STAGES.map((s) => build.stages[s.id].status !== "pending").lastIndexOf(true);
  const stage = step >= 0 ? STAGES[step] : null;
  // Turned away before anything ran (the credit limit, usually): the message is all there is to show.
  const refused = build.status === "error" && !stage;
  const latest = [...STAGES].reverse().find((s) => build.stages[s.id].detail);
  // "error" and "lost" announce themselves through role="alert" below.
  const statusLine =
    build.status === "done"
      ? heading
      : build.status !== "running"
        ? ""
        : stage
          ? `Step ${step + 1} of ${STAGES.length}: ${stage.label}`
          : "Starting the build";

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

        {refused ? null : (
          <>
            <ol className={styles.route} aria-label="Build steps">
              {STAGES.map((s) => {
                const st = build.stages[s.id];
                const failed = build.status === "error" && st.status === "active";
                return (
                  <li key={s.id} className={styles.leg} data-state={failed ? "failed" : st.status}>
                    {s.label}
                    <span className="visually-hidden">
                      {failed ? " (stopped)" : st.status === "done" ? " (done)" : st.status === "active" ? " (in progress)" : ""}
                    </span>
                  </li>
                );
              })}
            </ol>

            <p className={styles.elapsed}>
              <span className={styles.clock}>{formatDuration(total)}</span>{" "}
              {build.status === "running"
                ? "so far. It usually takes a minute or two, and it keeps going if you leave this page."
                : build.status === "lost"
                  ? "so far"
                  : "in total"}
            </p>
          </>
        )}

        {build.instant ? null : (
          <ul className={styles.log}>
            {STAGES.filter((s) => build.stages[s.id].detail && !(s.id === "publish" && build.story)).map((s) => {
              const st = build.stages[s.id];
              const took = st.startedAt && st.endedAt ? Math.round((st.endedAt - st.startedAt) / 1000) : null;
              return (
                <li key={s.id} className={styles.logLine}>
                  <span>{plainDetail(st.detail ?? "")}</span>
                  {took != null ? <span className={styles.took}>{took} s</span> : null}
                </li>
              );
            })}
          </ul>
        )}

        {build.status === "error" ? (
          <div className="notice" data-tone="error" role="alert">
            <p>{build.error}</p>
            {refused ? null : (
              <p className={styles.noticeAction}>Anything already downloaded is kept, so trying again picks up where this stopped.</p>
            )}
          </div>
        ) : null}

        {build.status === "lost" ? (
          <p className="notice" role="alert">
            The build is still running on the server. The video joins the list at the top when it’s done, usually within a couple of
            minutes.
          </p>
        ) : null}

        {build.status === "done" && build.story ? (
          <>
            <p className={styles.doneStats}>
              {build.story.clips} clips from {build.story.transmissionsReviewed} transmissions. Cost {formatUsd(build.story.costUsd)} to
              make.
            </p>
            <div className={styles.doneActions}>
              <DownloadMp4 eventId={build.story.eventId} />
              <Link className="btn btn-quiet" href={`/watch/${build.story.eventId}`}>
                Open it with the transcript
              </Link>
            </div>
          </>
        ) : null}
      </div>

      <div className={styles.buildScreen} data-status={build.status} hidden={refused}>
        {build.status === "done" && build.props ? (
          <PhonePlayer
            story={build.props}
            initialFrame={Math.round(build.props.introSec * 30 * 0.8)}
            spaceKeyToPlayOrPause={false}
          />
        ) : (
          <div className={styles.slot}>
            {build.status === "running" ? (
              <>
                <p key={stage?.id ?? "start"} className={styles.slotStage}>
                  {stage?.label ?? "Starting"}
                </p>
                <p className={styles.slotHint}>{stage?.hint}</p>
                {latest ? (
                  <p key={latest.id} className={styles.slotLatest}>
                    {plainDetail(build.stages[latest.id].detail ?? "")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className={styles.slotStage}>{build.status === "lost" ? "Still going" : "Stopped"}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
