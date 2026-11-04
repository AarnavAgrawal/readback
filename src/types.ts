/**
 * Contract between the data pipeline (pipeline/) and the video (src/).
 * The pipeline writes `public/stories/<eventId>/render-props.json` matching
 * `RenderProps`; the StoryVideo composition renders it. All times are in
 * seconds on the video timeline unless the name says otherwise.
 */

export type SpeakerRole = "controller" | "pilot";

/** Where the aircraft is in the story; drives the airport map animation. */
export type FlightPhase =
  | "final" // on approach to the runway
  | "go-around" // climbing away from the runway
  | "vectors" // being turned around by approach control
  | "landing" // cleared to land / touching down
  | "taxi"; // on the ground

export type Word = {
  text: string;
  /** Seconds on the video timeline. */
  startSec: number;
  endSec: number;
};

/** One radio transmission placed on the video timeline. */
export type Segment = {
  audioSampleId: string;
  startSec: number;
  endSec: number;
  role: SpeakerRole;
  /** e.g. "SFO TOWER" or "UNITED 1274" */
  speakerLabel: string;
  /** e.g. "120.5" (MHz), shown in the speaker badge */
  frequency: string;
  /** Verbatim transcript text. */
  text: string;
  /** Word-level timing for karaoke captions (may be estimated). */
  words: Word[];
  /** Short on-screen annotation, e.g. "GO AROUND" (optional). */
  note: string | null;
  phase: FlightPhase;
  /**
   * Runway end this beat is about, e.g. "22R" — the one being approached,
   * gone around from, landed on, or (for vectors) being vectored to.
   * Falls back to RenderProps.activeRunway. Lets a story switch runways.
   */
  runway?: string;
  /** Real UTC time the transmission was heard, ISO 8601. */
  realTimeUtc: string;
};

/** A card that appears over the video to explain a concept. */
export type Explainer = {
  startSec: number;
  endSec: number;
  heading: string;
  body: string;
};

/** A compressed real-world gap, e.g. "7 minutes later". */
export type TimeJump = {
  startSec: number;
  endSec: number;
  label: string;
};

/** Runway centerline in normalized map coordinates (0..1, y down, north up). */
export type RunwayGeom = {
  /** e.g. "10L/28R" */
  name: string;
  /** Low-numbered end, e.g. "10L" */
  le: { ident: string; x: number; y: number };
  /** High-numbered end, e.g. "28R" */
  he: { ident: string; x: number; y: number };
  /** Width in normalized units (for stroke width). */
  width: number;
};

export type RenderProps = {
  eventId: string;
  title: string;
  /** A short verbatim quote used as the opening hook. */
  hook: string;
  airportCode: string; // "SFO"
  airportName: string; // "San Francisco International"
  /** Runway ident the story centers on, e.g. "28L". Must match a runway end. */
  activeRunway: string;
  runways: RunwayGeom[];
  /**
   * Path relative to public/, used with staticFile(). The WAV covers the
   * whole video timeline: it starts at t=0 (the intro is silence in the file).
   */
  audioSrc: string;
  /** Total timeline length in seconds; equals the WAV's duration. */
  totalSec: number;
  /** ICAO callsign of the flight, e.g. "UAL1274". Derived from segments if absent. */
  callsign?: string;
  /** IANA time zone of the airport, e.g. "America/Los_Angeles". Looked up if absent. */
  timeZone?: string;
  /** Seconds before the first segment starts (title card time). */
  introSec: number;
  segments: Segment[];
  explainers: Explainer[];
  timeJumps: TimeJump[];
  /** e.g. "IMC · light rain · wind 080° at 8 kt" */
  conditions: string | null;
  /** Local date line, e.g. "Nov 3, 2026 · 9:58 PM PT" */
  dateLine: string;
};
