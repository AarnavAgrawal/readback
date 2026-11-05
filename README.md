# Readback

Turns a notable moment on US air traffic control radio (a go-around, an emergency, a laser strike) into a 30–60s vertical video. The video uses the **real radio audio**, verbatim karaoke captions, a schematic airport map and explainer cards. Data comes from the [Enhanced Radar API](https://enhancedradar.com/docs/api), the story framing from Claude, and the video is rendered with [Remotion](https://remotion.dev).

```
 Enhanced Radar events ─► discover ─► collect ─► clean ─► storyboard (Claude) ─► audio ─► props ─► render (Remotion)
```

## Setup

```bash
npm i
cp .env.example .env          # add ENHANCED_RADAR_API_KEY and ANTHROPIC_API_KEY
# runway geometry (public domain, ~15 MB):
mkdir -p data/ourairports
curl -o data/ourairports/runways.csv https://davidmegginson.github.io/ourairports-data/runways.csv
curl -o data/ourairports/airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
```

Requirements:
- Node 20.19+ or 24+.
- An Enhanced Radar account with the dashboard liveness check completed (needed for audio clips).

## Usage

```bash
# 1. Find stories: event searches at an airport in the last N hours (≤48)
npm run discover -- --airport SFO --hours 24
#    costs $1 per query + $1 per event returned (default 4 queries × 5 events ≤ $24)

# 2. Build one story into render props + audio, then preview
npm run story -- --event 5627999
npm run studio                 # Remotion Studio → StoryVideo

# 3. Render the MP4
npm run story -- --event 5627999 --render     # → out/5627999.mp4
```

Each stage caches its output in `data/stories/<event_id>/`, so re-running never pays for the same data twice. Flags:
- `--force-collect` re-fetches transcripts.
- `--force-storyboard` asks Claude for a new storyboard.

Every charged API call is logged to `data/stories/<event_id>/costs.jsonl`.

## Web app

Live at https://readback-atc.vercel.app. A Next.js app (`app/`, `server/`) in the same package: a gallery of finished stories, plus "Make one now", which runs the pipeline in a Vercel Function and streams progress to the page. Videos play in the browser with Remotion's Player.

```bash
npm run dev                                                   # http://localhost:3000
npm run publish:story -- --event <id> [--event <id>] --featured   # add a CLI-built story to the gallery
git push                                                      # pushing to main deploys the site
```

- **Storage:** Vercel Blob for story files and Upstash Redis for caches and the gallery index. Without their env vars, local dev uses `.local-store/`.
- **Usage limit:** new searches and builds stop when total Enhanced Radar usage reaches `DEMO_TOTAL_CAP_USD` ($800), measured as `DEMO_STARTING_CREDIT_USD` minus the balance the API reports. The gallery keeps working.
- **Caching:** airport searches are cached for 6 hours and finished videos are reused.
- **MP4 downloads:** rendered on demand in a Vercel Sandbox and stored in Blob. `npm run build` bundles the composition into `build/` for this.

## Pipeline stages (`pipeline/`)

| Stage | What it does | Enhanced Radar cost |
|---|---|---|
| `discover` | Event searches; groups duplicate events per incident; ranks them by type, evidence and stated cause | $1/query + $1/event |
| `collect` | `GET /events/{id}`, then every transcript for the flight's callsign(s) from 10 min before to 15 min after | $0.03/transcript (≈ $1–2) |
| `clean` | Removes duplicates (the same audio heard on two frequencies), orders by start time, fixes controller/pilot roles, labels channels | free (facility list is free) |
| `storyboard` | Claude (`claude-opus-5-5`, structured output) picks 5–10 beats, a verbatim hook, notes and explainers; the result is checked against the transcripts | — |
| `audio` | Downloads clips (links expire in 3 min, so they're fetched immediately), applies a radio band-pass and loudness normalization, adds static gaps, "N minutes later" jumps and explainer pauses | $0.02/clip |
| `props` | Writes `public/stories/<id>/render-props.json` (see `src/types.ts`) with OurAirports runway geometry and local time | — |
| `render` | `remotion render` → `out/<id>.mp4` | — |

Typical cost per video: **≈ $2–4** in Enhanced Radar credits.

## Video (`src/`)

`StoryVideo` is a 1080×1920, 30 fps composition driven entirely by `RenderProps`:
- title card with the hook quote
- airport map with an animated, phase-driven flight path
- speaker badge (amber for ATC, cyan for the pilot)
- karaoke captions and a waveform
- note stamps, explainer cards, time-jump cards
- an end card with a recap and attribution
