/**
 * MP4 rendering for the "Download MP4" button. Renders the same StoryVideo
 * composition in a Vercel Sandbox (Chrome + FFmpeg) and uploads the result to
 * Blob. Each story is rendered once; later downloads reuse the file.
 *
 * The Remotion bundle is built by `npm run build` into ./build and shipped
 * with this function (see outputFileTracingIncludes in next.config.ts).
 *
 * The sandbox never sees the store-wide Blob token: it gets a short-lived
 * token that can only write this story's MP4.
 */
import { addBundleToSandbox, createSandbox, getRenderProgress, renderMediaOnVercel } from "@remotion/vercel";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { Sandbox } from "@vercel/sandbox";
import { getStoryProps } from "./demo";
import { fileUrl, kvDel, kvGet, kvSet, kvSetNx } from "./store";

export type RenderState =
  | { status: "none" }
  | { status: "rendering"; progress: number; stage: string }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

type StoredState =
  | { status: "rendering"; sandboxId: string; cmdId: string; startedAt: number }
  | { status: "done"; url: string }
  | { status: "error"; message: string };

const BUNDLE_DIR = "build";
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const STARTING: RenderState = { status: "rendering", progress: 0, stage: "starting" };
const key = (eventId: string) => `render:${eventId}`;
const blobPath = (eventId: string) => `stories/${eventId}/readback.mp4`;

/** Starts rendering a story's MP4 (or returns the render already in progress / finished). */
export async function startRender(eventId: string): Promise<RenderState> {
  const current = await renderStatus(eventId);
  if (current.status === "done" || current.status === "rendering") return current;

  const props = await getStoryProps(eventId);
  if (!props) throw new Error("Story not found");
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) throw new Error("MP4 rendering needs Vercel Blob (BLOB_READ_WRITE_TOKEN).");

  // TTL above the route's 300 s limit; held until the render state is recorded.
  const lock = `lock:render:${eventId}`;
  if (!(await kvSetNx(lock, "1", 330))) return STARTING;

  let sandbox: Awaited<ReturnType<typeof createSandbox>> | null = null;
  try {
    // Someone else may have finished starting between our status check and the lock.
    const recheck = await kvGet<StoredState>(key(eventId));
    if (recheck?.status === "rendering" || recheck?.status === "done") return renderStatus(eventId);

    const scopedToken = await generateClientTokenFromReadWriteToken({
      token: blobToken,
      pathname: blobPath(eventId),
      allowOverwrite: true,
      allowedContentTypes: ["video/mp4"],
      validUntil: Date.now() + SANDBOX_TIMEOUT_MS + 5 * 60 * 1000,
    });
    sandbox = await createSandbox({ timeoutInMilliseconds: 4 * 60 * 1000 });
    await addBundleToSandbox({ sandbox, bundleDir: BUNDLE_DIR });
    const { sandboxId, cmdId } = await renderMediaOnVercel({
      sandbox,
      compositionId: "StoryVideo",
      inputProps: { ...props, audioAvailable: true },
      codec: "h264",
      detached: true,
      detachedSandboxTimeoutInMilliseconds: SANDBOX_TIMEOUT_MS,
      vercelBlob: { blobToken: scopedToken, access: "public", blobPath: blobPath(eventId) },
    });
    await kvSet(key(eventId), { status: "rendering", sandboxId, cmdId, startedAt: Date.now() } satisfies StoredState, 3600);
    return STARTING;
  } catch (err) {
    await sandbox?.stop().catch(() => undefined); // don't leave a failed sandbox running
    throw err;
  } finally {
    await kvDel(lock);
  }
}

/** Current state of a story's MP4, advancing it if a render just finished. */
export async function renderStatus(eventId: string): Promise<RenderState> {
  const stored = await kvGet<StoredState>(key(eventId));
  if (!stored) return (await kvGet(`lock:render:${eventId}`)) ? STARTING : { status: "none" };
  if (stored.status !== "rendering") return stored;

  const stop = () =>
    Sandbox.get({ sandboxId: stored.sandboxId })
      .then((s) => s.stop())
      .catch(() => undefined);

  let progress: Awaited<ReturnType<typeof getRenderProgress>>;
  try {
    progress = await getRenderProgress({ sandboxId: stored.sandboxId, cmdId: stored.cmdId });
  } catch (err) {
    // The sandbox may be gone. Never leave a story stuck: settle from what's in Blob.
    console.error(`[render] progress check for ${eventId} failed`, err);
    return settleFromBlob(eventId);
  }

  switch (progress.stage) {
    case "done": {
      const done: StoredState = { status: "done", url: progress.url };
      await kvSet(key(eventId), done);
      await stop();
      return done;
    }
    case "error": {
      const failed: StoredState = { status: "error", message: "The render failed. Try again." };
      console.error(`[render] ${eventId} failed: ${progress.message}`);
      await kvSet(key(eventId), failed, 300);
      await stop();
      return failed;
    }
    case "expired":
      return settleFromBlob(eventId);
    default:
      return { status: "rendering", progress: progress.overallProgress, stage: progress.stage };
  }
}

/** The render's sandbox is gone: use the MP4 if it reached Blob, otherwise allow a retry. */
async function settleFromBlob(eventId: string): Promise<RenderState> {
  const url = await fileUrl(blobPath(eventId));
  if (url) {
    const done: StoredState = { status: "done", url };
    await kvSet(key(eventId), done);
    return done;
  }
  await kvDel(key(eventId));
  return { status: "none" };
}
