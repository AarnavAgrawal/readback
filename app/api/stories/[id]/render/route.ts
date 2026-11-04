import { canonicalEventId } from "../../../../../server/demo";
import { renderStatus, startRender } from "../../../../../server/render";

export const dynamic = "force-dynamic";
// Starting a sandbox installs Chrome + dependencies; the render itself runs detached.
export const maxDuration = 300;


/** Status of a story's MP4: none | rendering | done (with url) | error. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (canonicalEventId(id) !== id) return Response.json({ error: "Invalid id" }, { status: 400 });
  try {
    return Response.json(await renderStatus(id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[render] status ${id} failed`, err);
    return Response.json({ status: "error", message: "Could not check the render." }, { status: 502 });
  }
}

/** Starts rendering a story's MP4 (idempotent). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (canonicalEventId(id) !== id) return Response.json({ error: "Invalid id" }, { status: 400 });
  try {
    return Response.json(await startRender(id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[render] start ${id} failed`, err);
    return Response.json({ status: "error", message: "Could not start the render." }, { status: 502 });
  }
}
