const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];

function missingEnvVars() {
  return REQUIRED_ENV.filter(key => !process.env[key]);
}

function configPage(missing) {
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
    const ok = Boolean(process.env[key]);
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

let handlerPromise;

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const missing = missingEnvVars();
  if (missing.length) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.statusCode = 503;
    res.end(configPage(missing));
    return;
  }
  if (!handlerPromise) {
    handlerPromise = import('../src/server.js').then(m => m.handle);
  }
  const handle = await handlerPromise;
  try {
    await handle(req, res);
  } catch (err) {
    const { respondToError } = await import('../src/server.js');
    respondToError(req, res, err);
  }
}
