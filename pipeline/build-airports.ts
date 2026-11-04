/**
 * Builds data/airports.json — a compact table of US airports (large + medium)
 * with runway endpoints — from the public-domain OurAirports CSVs.
 *
 *   npx tsx pipeline/build-airports.ts
 *
 * Inputs (download once, gitignored):
 *   data/ourairports/airports.csv, data/ourairports/runways.csv
 *   from https://davidmegginson.github.io/ourairports-data/
 */
import fs from "node:fs";
import path from "node:path";
import type { AirportRecord } from "./lib";

const SRC = path.join(process.cwd(), "data", "ourairports");
const OUT = path.join(process.cwd(), "data", "airports.json");

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function readCsv(file: string): Record<string, string>[] {
  const lines = fs.readFileSync(path.join(SRC, file), "utf8").split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

const airports = readCsv("airports.csv").filter(
  (a) => a.iso_country === "US" && (a.type === "large_airport" || a.type === "medium_airport"),
);
const byIdent = new Map(airports.map((a) => [a.ident, a]));
const runwaysByAirport = new Map<string, AirportRecord["runways"]>();
for (const r of readCsv("runways.csv")) {
  if (!byIdent.has(r.airport_ident) || r.closed === "1" || !r.le_latitude_deg || !r.he_latitude_deg) continue;
  const list = runwaysByAirport.get(r.airport_ident) ?? [];
  list.push({
    le: { ident: r.le_ident, lat: +r.le_latitude_deg, lon: +r.le_longitude_deg },
    he: { ident: r.he_ident, lat: +r.he_latitude_deg, lon: +r.he_longitude_deg },
    width_ft: Number(r.width_ft) || 150,
  });
  runwaysByAirport.set(r.airport_ident, list);
}

const table: Record<string, AirportRecord> = {};
for (const a of airports) {
  const runways = runwaysByAirport.get(a.ident);
  if (!runways?.length) continue;
  table[a.ident] = {
    icao: a.icao_code || a.gps_code || a.ident,
    iata: a.iata_code || null,
    name: a.name,
    lat: +a.latitude_deg,
    lon: +a.longitude_deg,
    runways,
  };
}

fs.writeFileSync(OUT, JSON.stringify(table));
console.log(`Wrote ${Object.keys(table).length} airports to ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
