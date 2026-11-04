/**
 * CLI for the ATC story-video pipeline.
 *
 *   npm run discover -- --airport SFO [--hours 24] [--limit 5] [--queries "go around,laser strike"]
 *   npm run story -- --event 5627999 [--force-collect] [--force-storyboard] [--render]
 */
import "dotenv/config";
import fs from "node:fs";
import { parseArgs } from "node:util";
import { sessionSpend } from "./er";
import { storyPaths, sumLedger } from "./lib";
import { buildAudio, buildProps, clean, collect, discover, hasClaudeCredentials, render, storyboard } from "./stages";

const [command, ...rest] = process.argv.slice(2);

async function main() {
  if (command === "discover") {
    const { values } = parseArgs({
      args: rest,
      options: {
        airport: { type: "string" },
        hours: { type: "string", default: "24" },
        limit: { type: "string", default: "5" },
        queries: { type: "string" },
      },
    });
    if (!values.airport) throw new Error("--airport is required, e.g. --airport SFO");
    const hours = Number(values.hours);
    const limit = Number(values.limit);
    if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours must be a positive number (max 48)");
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("--limit must be an integer from 1 to 25");
    const { candidates, outFile } = await discover({
      airport: values.airport,
      hours,
      limit,
      queries: values.queries?.split(",").map((s) => s.trim()).filter(Boolean),
    });
    console.log("\n score  event_id   time (UTC)            callsigns        summary");
    for (const c of candidates) {
      console.log(
        ` ${c.score.toFixed(1).padStart(5)}  ${String(c.event_id).padEnd(9)}  ${c.happened_at.slice(0, 19)}  ${c.callsigns.join(",").padEnd(15)}  ${c.summary.slice(0, 90)}`,
      );
    }
    console.log(`\nSaved ${outFile}`);
    console.log(`Spent $${sessionSpend().toFixed(2)} on this search. Next: npm run story -- --event <event_id>`);
    return;
  }

  if (command === "story") {
    const { values } = parseArgs({
      args: rest,
      options: {
        event: { type: "string" },
        "force-collect": { type: "boolean", default: false },
        "force-storyboard": { type: "boolean", default: false },
        render: { type: "boolean", default: false },
      },
    });
    const eventId = Number(values.event);
    if (!Number.isInteger(eventId) || eventId <= 0) throw new Error("--event <event_id> is required");
    // Fail before spending Enhanced Radar credits if the storyboard stage can't run.
    const p0 = storyPaths(eventId);
    if ((!fs.existsSync(p0.storyboard) || values["force-storyboard"]) && !hasClaudeCredentials()) {
      throw new Error("A new storyboard needs ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in .env.");
    }

    console.log(`[1/5] collect`);
    await collect(eventId, { force: values["force-collect"] });
    console.log(`[2/5] clean`);
    await clean(eventId);
    console.log(`[3/5] storyboard`);
    await storyboard(eventId, { force: values["force-storyboard"] });
    console.log(`[4/5] audio`);
    await buildAudio(eventId);
    console.log(`[5/5] props`);
    buildProps(eventId);
    if (values.render) {
      console.log(`[+] render`);
      render(eventId);
    } else {
      console.log(`\nPreview: npm run studio  ·  Render: npm run story -- --event ${eventId} --render`);
    }
    const p = storyPaths(eventId);
    console.log(
      `Enhanced Radar cost: $${sessionSpend().toFixed(2)} this run, $${sumLedger(p.costs).toFixed(2)} total for this story (data/stories/${eventId}/costs.jsonl).`,
    );
    return;
  }

  console.log("Usage:\n  npm run discover -- --airport SFO [--hours 24]\n  npm run story -- --event <event_id> [--render]");
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
