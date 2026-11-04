import { demoAirports } from "../../../server/demo";

export const dynamic = "force-dynamic";

/** Airports offered in the demo (only ones Enhanced Radar covers). */
export async function GET() {
  try {
    return Response.json(await demoAirports());
  } catch (err) {
    console.error("[airports] failed", err);
    return Response.json({ error: "Could not load airports" }, { status: 502 });
  }
}
