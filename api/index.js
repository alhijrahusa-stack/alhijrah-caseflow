function hydrateRuntimeEnv() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!process.env.SUPABASE_URL && supabaseUrl) process.env.SUPABASE_URL = supabaseUrl;
  if (!process.env.SUPABASE_ANON_KEY && supabaseAnonKey) process.env.SUPABASE_ANON_KEY = supabaseAnonKey;

  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: supabaseAnonKey,
  };
}

function errorPage(err) {
  const safe = String(err.message || 'Unknown error').replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alhijrah Caseflow — Startup Error</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#fef2f2;color:#1e293b;padding:2rem;display:flex;justify-content:center}
.card{max-width:580px;width:100%;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:2rem}
h1{font-size:1.5rem;margin-bottom:.5rem;color:#dc2626}p{color:#64748b;margin-bottom:1rem}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.85rem;word-break:break-all}
</style></head><body><div class="card">
<h1>Startup Error</h1>
<p>The application failed to initialize.</p>
<p><code>${safe}</code></p>
</div></body></html>`;
}

let handlerPromise;

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const runtimeConfig = hydrateRuntimeEnv();
  const missing = Object.entries(runtimeConfig).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    console.warn('[caseflow] runtime env missing:', missing.join(', '));
  }

  if (!handlerPromise) {
    handlerPromise = import('../src/server.js').then(m => m.handle).catch(err => {
      console.error('Failed to load application module:', err);
      throw err;
    });
  }

  let handle;
  try {
    handle = await handlerPromise;
  } catch (err) {
    handlerPromise = null;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.statusCode = 500;
    res.end(errorPage(err));
    return;
  }

  try {
    await handle(req, res);
  } catch (err) {
    try {
      const { respondToError } = await import('../src/server.js');
      respondToError(req, res, err);
    } catch {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
    }
  }
}
