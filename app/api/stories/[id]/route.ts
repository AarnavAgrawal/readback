import { canonicalEventId, getStoryProps } from "../../../../server/demo";

export const dynamic = "force-dynamic";

/** The render props (incl. audio URL) for one published story. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (canonicalEventId(id) !== id) return Response.json({ error: "Invalid id" }, { status: 400 });
  const props = await getStoryProps(id);
  if (!props) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(props, { headers: { "Cache-Control": "no-store" } });
}
