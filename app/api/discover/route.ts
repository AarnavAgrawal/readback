import { BudgetError, demoAirports, discoverCached } from "../../../server/demo";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Ranked candidate stories at an airport over the last 24 h (cached for 6 h). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const airport = (searchParams.get("airport") ?? "").toUpperCase();
  const refresh = searchParams.get("refresh") === "1";
  try {
    const allowed = await demoAirports();
    if (!allowed.some((a) => a.code === airport)) {
      return Response.json({ error: `Pick one of: ${allowed.map((a) => a.code).join(", ")}` }, { status: 400 });
    }
    return Response.json(await discoverCached(airport, { refresh }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[discover] ${airport} failed`, err);
    if (err instanceof BudgetError) return Response.json({ error: err.message }, { status: 429 });
    return Response.json({ error: "The search failed. Try again in a moment." }, { status: 502 });
  }
}
