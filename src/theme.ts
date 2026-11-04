import { loadFont as loadB612 } from "@remotion/google-fonts/B612";
import { loadFont as loadB612Mono } from "@remotion/google-fonts/B612Mono";
import type { SpeakerRole } from "./types";

// B612 was drawn for Airbus cockpit displays: built for legibility on glass.
const { fontFamily: b612 } = loadB612("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});
const { fontFamily: b612Mono } = loadB612Mono("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

export const FONT = b612;
export const MONO = b612Mono;

/** Glass-cockpit palette. Magenta is reserved for the flight path, as on a real nav display. */
export const C = {
  scope: "#061826",
  scopeDeep: "#03101B",
  panel: "#0A2233",
  grid: "#123A52",
  gridBright: "#1F5470",
  text: "#E6F0F4",
  dim: "#7F9AAB",
  faint: "#3E5C6E",
  atc: "#FFB547",
  pilot: "#5CE1F2",
  route: "#E66BD9",
  warning: "#FF4D4D",
  go: "#5BE38C",
  info: "#B9C8FF",
  runway: "#A9B8C2",
} as const;

export const roleColor = (role: SpeakerRole): string =>
  role === "controller" ? C.atc : C.pilot;

/** Composition layout, in px on the 1080×1920 canvas. */
export const LAYOUT = {
  side: 60,
  headerTop: 96,
  mapTop: 214,
  mapHeight: 790,
  badgeTop: 1040,
  captionTop: 1206,
  captionHeight: 330,
  waveTop: 1574,
  waveHeight: 130,
} as const;
