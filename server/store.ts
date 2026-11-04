/**
 * Storage for the web demo.
 *
 *  - Files (story JSON + audio): Vercel Blob when BLOB_READ_WRITE_TOKEN is set,
 *    otherwise ./.local-store (served by /api/files for local development).
 *  - Key-value (spend counter, caches, gallery index): Upstash Redis when its
 *    env vars are set (UPSTASH_REDIS_REST_* or the Marketplace KV_REST_API_*),
 *    otherwise a JSON file in ./.local-store.
 */
import { BlobNotFoundError, head, list, put } from "@vercel/blob";
import { Redis } from "@upstash/redis";
import fs from "node:fs";
import path from "node:path";

const LOCAL_ROOT = path.join(process.cwd(), ".local-store");
const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const hasRedis = () =>
  Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  );

// =====================================================================
// Files
// =====================================================================

/** Stores a file and returns a URL the browser can load it from. */
export async function putFile(key: string, body: Buffer | string, contentType: string): Promise<string> {
  if (hasBlob()) {
    const res = await put(key, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      cacheControlMaxAge: 60, // overwritable paths: keep audio and props in step after a republish
    });
    return res.url;
  }
  const file = path.join(LOCAL_ROOT, "files", key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return `/api/files/${key}`;
}

/** Reads a stored file, or null if it doesn't exist. */
export async function getFile(key: string): Promise<Buffer | null> {
  if (hasBlob()) {
    const url = await blobUrl(key);
    if (!url) return null;
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Blob read failed for ${key}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const file = path.join(LOCAL_ROOT, "files", key);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const buf = await getFile(key);
  return buf ? (JSON.parse(buf.toString("utf8")) as T) : null;
}

/** Public URL of a stored file, or null. */
export async function fileUrl(key: string): Promise<string | null> {
  if (hasBlob()) return blobUrl(key);
  return fs.existsSync(path.join(LOCAL_ROOT, "files", key)) ? `/api/files/${key}` : null;
}

/** URL of a blob, or null only if it truly doesn't exist (outages must not look like "missing"). */
async function blobUrl(key: string): Promise<string | null> {
  try {
    return (await head(key)).url;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

/** Keys of stored files under a prefix. */
export async function listFiles(prefix: string): Promise<string[]> {
  if (hasBlob()) {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await list({ prefix, cursor });
      keys.push(...res.blobs.map((b) => b.pathname));
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
    return keys;
  }
  const dir = path.join(LOCAL_ROOT, "files", prefix);
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(path.join(LOCAL_ROOT, "files"), full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/** Local-dev only: absolute path of a stored file (for the /api/files route). */
export function localFilePath(key: string): string | null {
  if (hasBlob()) return null;
  const file = path.resolve(LOCAL_ROOT, "files", key);
  // Refuse path traversal outside the store.
  if (!file.startsWith(path.resolve(LOCAL_ROOT, "files") + path.sep)) return null;
  return fs.existsSync(file) ? file : null;
}

// =====================================================================
// Key-value
// =====================================================================

let redis: Redis | null = null;
const getRedis = () => (redis ??= Redis.fromEnv());

type LocalKv = Record<string, { value: unknown; expiresAt: number | null }>;
const KV_FILE = path.join(LOCAL_ROOT, "kv.json");
function readLocalKv(): LocalKv {
  if (!fs.existsSync(KV_FILE)) return {};
  const kv = JSON.parse(fs.readFileSync(KV_FILE, "utf8")) as LocalKv;
  const now = Date.now();
  for (const [k, v] of Object.entries(kv)) if (v.expiresAt && v.expiresAt < now) delete kv[k];
  return kv;
}
function writeLocalKv(kv: LocalKv) {
  fs.mkdirSync(LOCAL_ROOT, { recursive: true });
  fs.writeFileSync(KV_FILE, JSON.stringify(kv, null, 2));
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (hasRedis()) return (await getRedis().get<T>(key)) ?? null;
  return (readLocalKv()[key]?.value as T) ?? null;
}

export async function kvSet(key: string, value: unknown, ttlSec?: number): Promise<void> {
  if (hasRedis()) {
    if (ttlSec) await getRedis().set(key, value, { ex: ttlSec });
    else await getRedis().set(key, value);
    return;
  }
  const kv = readLocalKv();
  kv[key] = { value, expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null };
  writeLocalKv(kv);
}

/** Atomically adds to a numeric key, (re)setting its expiry, and returns the new value. */
export async function kvIncrFloat(key: string, by: number, ttlSec: number): Promise<number> {
  if (hasRedis()) {
    const r = getRedis();
    const value = await r.incrbyfloat(key, by);
    await r.expire(key, ttlSec);
    return Number(value);
  }
  const kv = readLocalKv();
  const value = Number(kv[key]?.value ?? 0) + by;
  kv[key] = { value, expiresAt: Date.now() + ttlSec * 1000 };
  writeLocalKv(kv);
  return value;
}

/** Sets a key only if absent (a simple lock). Returns true if this call set it. */
export async function kvSetNx(key: string, value: string, ttlSec?: number): Promise<boolean> {
  if (hasRedis()) {
    const options = ttlSec ? { nx: true as const, ex: ttlSec } : { nx: true as const };
    return (await getRedis().set(key, value, options)) === "OK";
  }
  const kv = readLocalKv();
  if (kv[key]) return false;
  kv[key] = { value, expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null };
  writeLocalKv(kv);
  return true;
}

export async function kvDel(key: string): Promise<void> {
  if (hasRedis()) {
    await getRedis().del(key);
    return;
  }
  const kv = readLocalKv();
  delete kv[key];
  writeLocalKv(kv);
}

export async function hashSet(key: string, field: string, value: unknown): Promise<void> {
  if (hasRedis()) {
    await getRedis().hset(key, { [field]: value });
    return;
  }
  const kv = readLocalKv();
  const h = (kv[key]?.value as Record<string, unknown>) ?? {};
  h[field] = value;
  kv[key] = { value: h, expiresAt: null };
  writeLocalKv(kv);
}

export async function hashGetAll<T>(key: string): Promise<Record<string, T>> {
  if (hasRedis()) return ((await getRedis().hgetall<Record<string, T>>(key)) ?? {}) as Record<string, T>;
  return ((readLocalKv()[key]?.value as Record<string, T>) ?? {}) as Record<string, T>;
}

export const storageMode = () => ({ files: hasBlob() ? "vercel-blob" : "local", kv: hasRedis() ? "upstash-redis" : "local" });
