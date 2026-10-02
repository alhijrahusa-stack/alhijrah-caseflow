// MURAILEX private-LAN gateway (local use only).
//
// HTTPS on 0.0.0.0:<HTTPS_PORT> -> the web app on 127.0.0.1 (which proxies /api to the API).
// HTTPS is required because phone browsers expose the microphone only in a secure context.
// HTTP on 0.0.0.0:<HTTP_PORT> serves only the local CA certificate (to trust it on the phone)
// and redirects everything else to HTTPS. Bodies are streamed in both directions, so large
// chunked uploads and ranged audio playback pass through unchanged.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const [, , certDir, httpsPort, httpPort, upstreamPort] = process.argv;
const upstream = { host: "127.0.0.1", port: Number(upstreamPort) };
const caPath = `${certDir}/murailex-local-ca.crt`;

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"]);

function forward(req, res) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-for"] = req.socket.remoteAddress ?? "";
  const up = http.request({ ...upstream, method: req.method, path: req.url, headers }, (r) => {
    const out = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k.toLowerCase())) out[k] = v;
    res.writeHead(r.statusCode ?? 502, out);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("MURAILEX web app is not reachable on this machine.");
  });
  req.pipe(up);
}

https
  .createServer(
    { key: fs.readFileSync(`${certDir}/server.key`), cert: fs.readFileSync(`${certDir}/server.crt`) },
    forward,
  )
  .listen(Number(httpsPort), "0.0.0.0");

http
  .createServer((req, res) => {
    if (req.url === "/murailex-local-ca.crt") {
      res.writeHead(200, {
        "content-type": "application/x-x509-ca-cert",
        "content-disposition": 'attachment; filename="murailex-local-ca.crt"',
      });
      fs.createReadStream(caPath).pipe(res);
      return;
    }
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    res.writeHead(308, { location: `https://${host}:${httpsPort}${req.url ?? "/"}` });
    res.end();
  })
  .listen(Number(httpPort), "0.0.0.0");
