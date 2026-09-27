const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

function getRuntimeConfig() {
  const config = {
    SUPABASE_URL: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    OWNER_EMAIL: process.env.OWNER_EMAIL,
    APP_BASE_URL: process.env.APP_BASE_URL,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PROVIDER_URL: process.env.AI_PROVIDER_URL,
    AI_PROVIDER_MODEL: process.env.AI_PROVIDER_MODEL,
    AI_PROVIDER_API_KEY: process.env.AI_PROVIDER_API_KEY,
  };

  if (!process.env.SUPABASE_URL && config.SUPABASE_URL) {
    process.env.SUPABASE_URL = config.SUPABASE_URL;
  }
  if (!process.env.SUPABASE_ANON_KEY && config.SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY;
  }

  return config;
}

function missingEnvVars(config) {
  return REQUIRED_ENV.filter(key => !config[key]);
}

function configPage(config, missing) {
  const checked = REQUIRED_ENV.map(key => {
    const ok = !missing.includes(key);
    return `<li style="margin:6px 0;color:${ok ? '#16a34a' : '#dc2626'}">${ok ? '&#10003;' : '&#10007;'} <code>${key}</code></li>`;
  }).join('');
  const optional = [
    'OWNER_EMAIL', 'APP_BASE_URL', 'INTERNAL_API_KEY',
    'R2_BUCKET', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
    'AI_PROVIDER', 'AI_PROVIDER_URL', 'AI_PROVIDER_MODEL', 'AI_PROVIDER_API_KEY',
  ].map(key => {
    const ok = Boolean(config[key]);
    return `<li style="margin:4px 0;color:${ok ? '#16a34a' : '#9ca3af'}">${ok ? '&#10003;' : '&#9675;'} <code>${key}</code></li>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alhijrah Caseflow — Setup Required</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem;display:flex;justify-content:center}
.card{max-width:580px;width:100%;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);padding:2rem}
h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#64748b;margin-bottom:1.5rem}
h2{font-size:1rem;margin-bottom:.75rem;color:#334155}ul{list-style:none;padding-left:.25rem}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:.85rem}
.sep{border-top:1px solid #e2e8f0;margin:1.25rem 0;padding-top:1rem}
</style></head><body><div class="card">
<h1>Alhijrah Caseflow</h1>
<p>The application cannot start because required environment variables are missing. Add them in your Vercel project settings under <strong>Settings &rarr; Environment Variables</strong>.</p>
<h2>Required</h2><ul>${checked}</ul>
<div class="sep"><h2>Optional</h2><ul>${optional}</ul></div>
</div></body></html>`;
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
<p>The application failed to initialize. This usually means a dependency could not load in this environment.</p>
<p><code>${safe}</code></p>
<p>Check the Vercel function logs for the full stack trace.</p>
</div></body></html>`;
}

let handlerPromise;

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const runtimeConfig = getRuntimeConfig();
  const missing = missingEnvVars(runtimeConfig);
  if (missing.length) {
    console.error('[caseflow] ENV CHECK FAILED — missing:', missing.join(', '));
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.statusCode = 503;
    res.end(configPage(runtimeConfig, missing));
    return;
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
