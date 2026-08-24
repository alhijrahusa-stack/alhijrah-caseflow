// Boots the stub backend and then the real API server in one process, so
// Playwright's webServer has a single command to manage.

import './stub-supabase.mjs';

const stubPort = Number(process.env.STUB_PORT || 54321);
const appPort = Number(process.env.PORT || 3100);

process.env.SUPABASE_URL = `http://127.0.0.1:${stubPort}`;
process.env.SUPABASE_ANON_KEY = 'e2e-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'e2e-service-role-key';
process.env.INTERNAL_API_KEY = 'e2e-internal-api-key';
process.env.APP_BASE_URL = `http://localhost:${appPort}`;
process.env.OWNER_EMAIL = 'owner@caseflow.test';

const { createServer } = await import('../../src/server.js');
createServer().listen(appPort, '127.0.0.1', () => console.log(`caseflow e2e app on ${appPort}`));
