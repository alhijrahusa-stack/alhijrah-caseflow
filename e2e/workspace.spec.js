import { expect, test } from '@playwright/test';

const MANAGER = { email: 'manager@caseflow.test', password: 'correct-horse-battery' };

async function signIn(page, credentials = MANAGER, { navigate = true } = {}) {
  if (navigate) await page.goto('/');
  await page.fill('#email', credentials.email);
  await page.fill('#password', credentials.password);
  await page.click('#signInBtn');
}

// signOut() reloads the page, so wait for the login panel to come back rather
// than racing a fresh navigation against the in-flight reload.
async function signOut(page) {
  await page.click('#signOutBtn');
  await expect(page.locator('#login')).toBeVisible();
}

test('the workspace is gated behind sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible();
  // Nothing case-related may render before authentication.
  await expect(page.locator('#caseTable tr')).toHaveCount(0);
});

test('bad credentials are refused and no session cookie is issued', async ({ page, context }) => {
  await signIn(page, { email: MANAGER.email, password: 'not-the-password' });
  await expect(page.locator('#loginErr')).toContainText(/incorrect|INVALID/i);
  const cookies = await context.cookies();
  expect(cookies.filter(cookie => cookie.name.startsWith('__Host-'))).toHaveLength(0);
});

test('a successful sign-in issues hardened session cookies', async ({ page, context }) => {
  await signIn(page);
  await expect(page.locator('#login')).toBeHidden();

  const cookies = await context.cookies();
  const session = cookies.filter(cookie => cookie.name.startsWith('__Host-caseflow'));
  expect(session.length).toBe(2);
  for (const cookie of session) {
    expect(cookie.httpOnly, `${cookie.name} must be HttpOnly`).toBe(true);
    expect(cookie.secure, `${cookie.name} must be Secure`).toBe(true);
    expect(cookie.sameSite, `${cookie.name} must be SameSite=Strict`).toBe('Strict');
    expect(cookie.path).toBe('/');
  }

  // The access token must never be reachable from page scripts.
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toContain('caseflow');
});

test('a case created through the UI round-trips, and its event is visible to an auditor', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#login')).toBeHidden();
  await page.click('#nav button[data-view="cases"]');
  await page.click('#newCaseButton');

  const clientName = `E2E Client ${Date.now()}`;
  await page.fill('#clientName', clientName);
  await page.selectOption('#caseType', { index: 0 });
  await page.selectOption('#priority', 'high');
  await page.click('#saveCaseBtn');

  await expect(page.locator('#caseModal')).not.toHaveClass(/show/);
  await expect(page.locator('#caseTable')).toContainText(clientName);

  // A case_manager holds no audit.view permission, so the audit destination is
  // not offered to them at all.
  await expect(page.locator('#nav button[data-view="audit"]')).toBeHidden();

  // The auditor, who does hold it, sees the event the manager generated.
  await signOut(page);
  await signIn(page, { email: 'auditor@caseflow.test', password: 'correct-horse-battery' }, { navigate: false });
  await expect(page.locator('#login')).toBeHidden();
  await page.click('#nav button[data-view="audit"]');
  await expect(page.locator('#auditTable')).toContainText('case_created');
});

test('navigation only offers destinations the role can actually reach', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('#nav button[data-view="cases"]')).toBeVisible();
  await expect(page.locator('#nav button[data-view="audit"]')).toBeHidden();
  await expect(page.locator('#nav button[data-view="settings"]')).toBeHidden();
  await expect(page.locator('#newCaseButton')).toBeVisible();

  await signOut(page);
  await signIn(page, { email: 'auditor@caseflow.test', password: 'correct-horse-battery' }, { navigate: false });
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('#nav button[data-view="audit"]')).toBeVisible();
  // An auditor is read-only: the create affordance is withheld.
  await expect(page.locator('#newCaseButton')).toBeHidden();
});

test('signing out clears the session and re-gates the workspace', async ({ page, context }) => {
  await signIn(page);
  await expect(page.locator('#login')).toBeHidden();

  await signOut(page);

  const remaining = (await context.cookies()).filter(cookie => cookie.name.startsWith('__Host-caseflow') && cookie.value);
  expect(remaining).toHaveLength(0);
});

test('the API refuses direct access without a session', async ({ request }) => {
  for (const path of ['/api/v1/cases', '/api/v1/documents', '/api/v1/audit', '/api/v1/users', '/api/v1/services']) {
    const response = await request.get(path);
    expect(response.status(), `${path} must require authentication`).toBe(401);
  }
});

test('portal roles are shut out of the staff workspace API', async ({ request, baseURL }) => {
  const login = await request.post('/api/v1/auth/login', {
    headers: { origin: baseURL, 'sec-fetch-site': 'same-origin' },
    data: { email: 'client@caseflow.test', password: 'correct-horse-battery' },
  });
  expect(login.status()).toBe(200);

  for (const path of ['/api/v1/cases', '/api/v1/documents', '/api/v1/audit', '/api/v1/users']) {
    const response = await request.get(path);
    expect(response.status(), `${path} must be closed to portal roles`).toBe(403);
  }
});

test('responses carry the security header set', async ({ request }) => {
  const response = await request.get('/health');
  const headers = response.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['strict-transport-security']).toContain('max-age=31536000');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
});

test('a cross-site write is rejected even with a valid session cookie', async ({ page, request }) => {
  await signIn(page);
  await expect(page.locator('#login')).toBeHidden();
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  const response = await request.post('/api/v1/cases', {
    headers: { cookie: cookieHeader, origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' },
    data: { client_name: 'CSRF', case_type: 'Naturalization' },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error).toBe('CROSS_SITE_REQUEST_BLOCKED');
});

// ---------------------------------------------------------------------------
// Owner access control
// ---------------------------------------------------------------------------

const OWNER = { email: 'owner@caseflow.test', password: 'correct-horse-battery' };

test('the Access Control view is offered to the Owner and withheld from staff', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('#nav button[data-view="access"]')).toBeHidden();

  await signOut(page);
  await signIn(page, OWNER, { navigate: false });
  await expect(page.locator('#login')).toBeHidden();
  await expect(page.locator('#nav button[data-view="access"]')).toBeVisible();
});

test('the Owner can narrow a user and widen them again from the UI', async ({ page }) => {
  // A case the manager is not assigned to, so narrowing has a visible effect.
  await signIn(page, OWNER);
  await expect(page.locator('#login')).toBeHidden();
  await page.click('#nav button[data-view="cases"]');
  await page.click('#newCaseButton');
  const clientName = `Scoped Client ${Date.now()}`;
  await page.fill('#clientName', clientName);
  await page.selectOption('#caseType', { index: 0 });
  await page.click('#saveCaseBtn');
  await expect(page.locator('#caseTable')).toContainText(clientName);

  // The manager sees it today, because staff default to firm-wide access.
  await signOut(page);
  await signIn(page, MANAGER, { navigate: false });
  await expect(page.locator('#caseTable')).toContainText(clientName);

  // The Owner narrows that one user to their assigned cases.
  await signOut(page);
  await signIn(page, OWNER, { navigate: false });
  await page.click('#nav button[data-view="access"]');
  await expect(page.locator('#accessSubject')).not.toBeEmpty();
  await page.selectOption('#accessSubjectType', 'user');
  await page.selectOption('#accessSubject', { label: 'Case Manager' });
  await page.selectOption('[data-scope="cases"]', 'assigned');
  await page.click('#accessSave');
  await expect(page.locator('#accessEffective')).toContainText('Assigned');

  await signOut(page);
  await signIn(page, MANAGER, { navigate: false });
  await page.click('#nav button[data-view="cases"]');
  await expect(page.locator('#caseTable')).not.toContainText(clientName);

  // And restores them by resetting the policy.
  await signOut(page);
  await signIn(page, OWNER, { navigate: false });
  await page.click('#nav button[data-view="access"]');
  await page.selectOption('#accessSubjectType', 'user');
  await page.selectOption('#accessSubject', { label: 'Case Manager' });
  await page.click('#accessClear');

  await signOut(page);
  await signIn(page, MANAGER, { navigate: false });
  await page.click('#nav button[data-view="cases"]');
  await expect(page.locator('#caseTable')).toContainText(clientName);
});

// ---------------------------------------------------------------------------
// Content-Security-Policy
// ---------------------------------------------------------------------------

test('the workspace runs without tripping the Content-Security-Policy', async ({ page }) => {
  // A CSP violation only logs; it does not fail a request. So collect them
  // directly from the browser and require the count to be zero after a real
  // interaction, otherwise "no inline script" would be an untested claim.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(`${event.violatedDirective} :: ${event.blockedURI}`);
    });
  });
  // Only genuine script faults. Non-2xx responses are ordinary application
  // behaviour here (401 before sign-in, 404 for the favicon, 503 from /ready
  // with no object storage configured) and say nothing about the policy.
  const scriptErrors = [];
  page.on('pageerror', (error) => scriptErrors.push(String(error.message)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      scriptErrors.push(message.text());
    }
  });

  await signIn(page);
  await expect(page.locator('#login')).toBeHidden();
  await page.click('#nav button[data-view="cases"]');
  await page.click('#newCaseButton');
  await expect(page.locator('#caseModal')).toHaveClass(/show/);
  // Close it through a converted handler, then navigate: an open modal would
  // intercept the next click.
  await page.click('#caseModal [data-act="closeCase"]');
  await expect(page.locator('#caseModal')).not.toHaveClass(/show/);
  await page.click('#nav button[data-view="documents"]');

  expect(await page.evaluate(() => window.__cspViolations), 'CSP must not be violated').toEqual([]);
  expect(scriptErrors, 'no script errors while driving the UI').toEqual([]);
});

test('the delivered page is free of inline script and inline handlers', async ({ page, request }) => {
  const response = await request.get('/');
  const html = await response.text();
  expect(/<script(?![^>]*\bsrc=)/.test(html), 'no inline <script> block').toBe(false);
  expect(/\son(click|input|change|submit|load|error)\s*=/i.test(html), 'no inline handlers').toBe(false);

  const csp = response.headers()['content-security-policy'];
  expect(csp.split(';').map((p) => p.trim()).find((p) => p.startsWith('script-src'))).toBe("script-src 'self'");

  // And the buttons still work, because intent now travels as data-act.
  await signIn(page);
  await expect(page.locator('#login')).toBeHidden();
  expect(await page.locator('[data-act]').count()).toBeGreaterThan(0);
});

test('every navigation destination the Owner is offered is actually clickable', async ({ page }) => {
  // The sidebar footer was absolutely positioned over the end of a nav that had
  // since grown, so the last destinations rendered but swallowed their clicks.
  // Rendering is not reachability: drive each one.
  await signIn(page, OWNER);
  await expect(page.locator('#login')).toBeHidden();

  const views = await page.locator('#nav button:visible').evaluateAll((nodes) => nodes.map((n) => n.dataset.view));
  expect(views.length).toBeGreaterThan(8);

  for (const view of views) {
    await page.click(`#nav button[data-view="${view}"]`, { timeout: 5000 });
    await expect(page.locator(`#view-${view}`), `${view} must open when its nav item is clicked`).toHaveClass(/active/);
  }
});
