import fs from "node:fs";
import { localFilePath } from "../../../../server/store";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { wav: "audio/wav", json: "application/json", mp4: "video/mp4" };

/**
 * Local development only: serves files from ./.local-store (in production
 * files live in Vercel Blob and are loaded from their Blob URLs). Supports
 * Range requests so the audio can be seeked.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const file = localFilePath(key.join("/"));
  if (!file) return new Response("Not found", { status: 404 });

  const size = fs.statSync(file).size;
  const type = TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const chunk = fs.readFileSync(file).subarray(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(chunk.length),
        "Accept-Ranges": "bytes",
      },
    });
  }
  return new Response(fs.readFileSync(file), {
    headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
  });
}
