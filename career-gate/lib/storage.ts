import "server-only";

// Supabase Storage REST calls, server-side only. The service role key never
// leaves the server.
export const BUCKET = "documents";
export const SIGNED_URL_SECONDS = 600;

export class StorageNotConfigured extends Error {
  code = "NOT_CONFIGURED";
}

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new StorageNotConfigured("Supabase Storage is NOT_CONFIGURED");
  return { base: `${url.replace(/\/$/, "")}/storage/v1`, key };
}

const encodePath = (path: string) => {
  if (path.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) throw new Error("Invalid storage path");
  return path.split("/").map(encodeURIComponent).join("/");
};

const headers = (key: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${key}`, apikey: key, ...extra });

async function fail(res: Response, what: string): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(`${what} failed (${res.status}) ${body.slice(0, 200)}`);
}

export async function uploadObject(path: string, bytes: Uint8Array, contentType: string) {
  const { base, key } = config();
  const res = await fetch(`${base}/object/${BUCKET}/${encodePath(path)}`, {
    method: "POST",
    headers: headers(key, { "Content-Type": contentType, "x-upsert": "false" }),
    body: Buffer.from(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await fail(res, "Storage upload");
}

export async function downloadObject(path: string): Promise<Uint8Array> {
  const { base, key } = config();
  const res = await fetch(`${base}/object/${BUCKET}/${encodePath(path)}`, { headers: headers(key), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) await fail(res, "Storage download");
  return new Uint8Array(await res.arrayBuffer());
}

export async function removeObject(path: string) {
  const { base, key } = config();
  const res = await fetch(`${base}/object/${BUCKET}`, {
    method: "DELETE",
    headers: headers(key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: [path] }),
  });
  if (!res.ok) await fail(res, "Storage delete");
}

export async function signedUrl(path: string, downloadName: string | null) {
  const { base, key } = config();
  const res = await fetch(`${base}/object/sign/${BUCKET}/${encodePath(path)}`, {
    method: "POST",
    headers: headers(key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
  });
  if (!res.ok) await fail(res, "Signed URL");
  const data = (await res.json()) as { signedURL?: string };
  if (!data.signedURL) throw new Error("Signed URL missing from Storage response");
  const url = new URL(`${base}${data.signedURL}`);
  if (downloadName) url.searchParams.set("download", downloadName);
  return { url: url.toString(), expiresIn: SIGNED_URL_SECONDS };
}
