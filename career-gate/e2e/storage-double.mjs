// Local stand-in for the four Supabase Storage REST endpoints the app calls
// (upload, download, sign, signed download, delete). Used only by the e2e suite;
// it never runs in production and no test result is derived from it alone.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = Number(process.env.STORAGE_PORT ?? 54999);
const objects = new Map(); // "bucket/path" -> { bytes, type }
const tokens = new Map(); // token -> { key, expires }

const body = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const send = (res, status, data, type = "application/json") => {
  res.writeHead(status, { "content-type": type });
  res.end(type === "application/json" ? JSON.stringify(data) : data);
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  if (req.method === "GET" && p.startsWith("/storage/v1/object/sign/")) {
    const t = tokens.get(url.searchParams.get("token"));
    const key = p.slice("/storage/v1/object/sign/".length);
    if (!t || t.key !== key || t.expires < Date.now()) return send(res, 400, { error: "invalid token" });
    const o = objects.get(key);
    return o ? send(res, 200, o.bytes, o.type) : send(res, 404, { error: "not found" });
  }
  if (req.headers.authorization !== `Bearer ${KEY}` || req.headers.apikey !== KEY) return send(res, 401, { error: "unauthorized" });
  if (req.method === "GET" && p.startsWith("/storage/v1/object/documents/")) {
    const o = objects.get(p.slice("/storage/v1/object/".length));
    return o ? send(res, 200, o.bytes, o.type) : send(res, 404, { error: "not found" });
  }
  if (req.method === "POST" && p.startsWith("/storage/v1/object/sign/")) {
    const key = p.slice("/storage/v1/object/sign/".length);
    if (!objects.has(key)) return send(res, 404, { error: "Object not found" });
    const { expiresIn } = JSON.parse((await body(req)).toString());
    const token = randomBytes(16).toString("hex");
    tokens.set(token, { key, expires: Date.now() + expiresIn * 1000 });
    return send(res, 200, { signedURL: `/object/sign/${key}?token=${token}` });
  }
  if (req.method === "POST" && p.startsWith("/storage/v1/object/")) {
    const key = p.slice("/storage/v1/object/".length);
    if (!key.startsWith("documents/")) return send(res, 404, { error: "Bucket not found" });
    if (objects.has(key) && req.headers["x-upsert"] !== "true") return send(res, 409, { error: "Duplicate" });
    objects.set(key, { bytes: await body(req), type: req.headers["content-type"] });
    return send(res, 200, { Key: key });
  }
  if (req.method === "DELETE" && p === "/storage/v1/object/documents") {
    const { prefixes } = JSON.parse((await body(req)).toString());
    for (const x of prefixes) objects.delete(`documents/${x}`);
    return send(res, 200, []);
  }
  send(res, 404, { error: "no route" });
}).listen(PORT, "127.0.0.1", () => console.log(`storage double on ${PORT}`));
