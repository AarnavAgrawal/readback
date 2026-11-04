import { after } from "next/server";
import { BudgetError, type ProgressEvent, buildStory, canonicalEventId, listStories } from "../../../server/demo";

export const dynamic = "force-dynamic";
// Collect + Claude storyboard + audio comfortably fits in Fluid Compute's default window.
export const maxDuration = 300;

/** Gallery: every published story, featured first. */
export async function GET() {
  return Response.json(await listStories(), { headers: { "Cache-Control": "no-store" } });
}

/**
 * Builds (or returns the already-built) video for an Enhanced Radar event,
 * streaming progress as newline-delimited JSON (ProgressEvent per line).
 * The build is paid work, so it runs to completion even if the visitor leaves.
 */
export async function POST(request: Request) {
  type Body = { eventId?: string | number } | null;
  let body: Body = null;
  try {
    body = (await request.json()) as Body;
  } catch {
    /* handled below */
  }
  const eventId = canonicalEventId((body as Body)?.eventId);
  if (!eventId) return Response.json({ error: "Body must be {\"eventId\": <number>}" }, { status: 400 });

  const encoder = new TextEncoder();
  let streamOpen = true;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const send = (e: ProgressEvent) => {
    if (!streamOpen || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
    } catch {
      streamOpen = false; // the visitor left; the build carries on
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      streamOpen = false;
    },
  });

  const build = buildStory(eventId, send)
    .catch((err: unknown) => {
      console.error(`[stories] build ${eventId} failed`, err);
      const message = err instanceof BudgetError ? err.message : "Building this video failed. Try another event.";
      send({ type: "error", message });
    })
    .finally(() => {
      if (streamOpen) {
        streamOpen = false;
        try {
          controllerRef?.close();
        } catch {
          /* already closed */
        }
      }
    });
  // Keep the function alive until the build finishes, even if the response ends first.
  after(() => build);

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
