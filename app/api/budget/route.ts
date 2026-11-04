import { budget } from "../../../server/demo";

export const dynamic = "force-dynamic";

/** Total Enhanced Radar usage against the demo's overall cap. */
export async function GET() {
  return Response.json(await budget(), { headers: { "Cache-Control": "no-store" } });
}
