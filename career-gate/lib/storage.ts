import "server-only";

// Supabase Storage REST calls, server-side only. The service role key never
// leaves the server.
export const BUCKET = "documents";
const SIGNED_URL_SECONDS = 600;

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return { base: `${url.replace(/\/$/, "")}/storage/v1`, key };
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function fail(res: Response, what: string): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(`${what} failed (${res.status}) ${body.slice(0, 200)}`);
}

export async function uploadObject(path: string, bytes: Uint8Array, contentType: string) {
  const { base, key } = config();
  const res = await fetch(`${base}/object/${BUCKET}/${encodePath(path)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: Buffer.from(bytes),
  });
  if (!res.ok) await fail(res, "Storage upload");
}

export async function removeObject(path: string) {
  const { base, key } = config();
  const res = await fetch(`${base}/object/${BUCKET}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  });
  if (!res.ok) await fail(res, "Storage delete");
}

export async function signedUrl(path: string, downloadName: string) {
  const { base, key } = config();
  const res = await fetch(`${base}/object/sign/${BUCKET}/${encodePath(path)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
  });
  if (!res.ok) await fail(res, "Signed URL");
  const data = (await res.json()) as { signedURL?: string };
  if (!data.signedURL) throw new Error("Signed URL missing from Storage response");
  const url = new URL(`${base}${data.signedURL}`);
  url.searchParams.set("download", downloadName);
  return { url: url.toString(), expiresIn: SIGNED_URL_SECONDS };
}
