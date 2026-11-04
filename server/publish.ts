/**
 * Publishes a story already built by the CLI pipeline to the demo's gallery
 * (Vercel Blob + Redis when their env vars are set, else .local-store).
 *
 *   npx tsx server/publish.ts --event 5627999 --featured
 *
 * To publish to production, pull the env first: `vercel env pull .env.local`.
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CACHE_DIR, DATA_DIR, storyPaths } from "../pipeline/lib";
import { buildProps } from "../pipeline/stages";
import { publishStory, recordBalance } from "./demo";
import { storageMode } from "./store";

loadEnv({ path: ".env.local", override: true, quiet: true });

const { values } = parseArgs({
  options: { event: { type: "string", multiple: true }, featured: { type: "boolean" } },
});

async function main() {
  const ids = values.event ?? [];
  if (ids.length === 0) throw new Error("Usage: npx tsx server/publish.ts --event <id> [--event <id>] [--featured]");
  console.log(`Publishing to ${JSON.stringify(storageMode())}`);
  for (const id of ids) {
    buildProps(Number(id)); // refresh props from the cached timeline/storyboard
    const { story } = await publishStory(id, { featured: values.featured });
    console.log(`  ✓ ${id} "${story.title}" (${story.durationSec.toFixed(0)} s, $${story.costUsd.toFixed(2)}) → ${story.propsUrl}`);
  }
  const balance = latestLedgerBalance();
  if (balance !== null) {
    await recordBalance(balance);
    console.log(`  Enhanced Radar balance recorded: $${balance.toFixed(2)}`);
  }
}

/** Most recent balance the API reported, across every local cost ledger. */
function latestLedgerBalance(): number | null {
  const ledgers = [
    path.join(CACHE_DIR, "discover-costs.jsonl"),
    ...(fs.existsSync(path.join(DATA_DIR, "stories"))
      ? fs.readdirSync(path.join(DATA_DIR, "stories")).map((id) => storyPaths(id).costs)
      : []),
  ];
  let latest: { at: string; balance_usd: number } | null = null;
  for (const file of ledgers) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      let row: { at: string; balance_usd: number | null };
      try {
        row = JSON.parse(line) as typeof row;
      } catch {
        continue; // skip a half-written line
      }
      if (row.balance_usd !== null && (!latest || row.at > latest.at)) latest = { at: row.at, balance_usd: row.balance_usd };
    }
  }
  return latest?.balance_usd ?? null;
}

main().catch((err: unknown) => {
  console.error(`✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
