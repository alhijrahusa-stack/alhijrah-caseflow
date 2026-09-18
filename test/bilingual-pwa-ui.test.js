import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const publicFile=(name)=>readFile(new URL(`../src/public/${name}`,import.meta.url),'utf8');

test('the administrative workspace and portal expose a complete bilingual surface',async()=>{
  const [html,script]=await Promise.all([publicFile('index.html'),publicFile('app.js')]);
  assert.match(html,/data-act="switchLanguage"/);
  for(const panel of ['portalCases','portalRequests','portalDocuments','portalBilling','portalAppointments','portalDeadlines','portalNotifications','portalProfile'])assert.match(html,new RegExp(`id="${panel}"`));
  for(const phrase of ['No active alerts.','Preview','Download','Delete','Approve','Reject','Manage','Work email','Sign In'])assert.ok(script.includes(`"${phrase}"`),`missing Arabic mapping for ${phrase}`);
  assert.match(script,/trimmed\.replace\(\/\\s\+\/g," "\)/);
  assert.match(script,/document\.documentElement\.dir=currentLanguage==="Arabic"\?"rtl":"ltr"/);
  assert.match(script,/MutationObserver/);
});

test('Case Workspace contains every operating surface under canonical client and case identifiers',async()=>{
  const html=await publicFile('index.html');
  const tabs=[...html.matchAll(/class="workspace-tab(?: active)?"[^>]+data-a1="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(tabs,['overview','journey','profile','intake','participants','forms','documents','rfe','actions','tasks','deadlines','appointments','communications','billing','notes','team','audit']);
  assert.match(html,/id="workspaceClientNumber"/);
  assert.match(html,/id="workspaceCaseNumber"/);
  for(const modal of ['participantModal','historyModal','formModal'])assert.match(html,new RegExp(`id="${modal}"`));
});

test('the client application is installable, mobile-first, and caches only the explicit static shell',async()=>{
  const [html,css,manifestSource,worker]=await Promise.all([publicFile('index.html'),publicFile('app.css'),publicFile('manifest.webmanifest'),publicFile('sw.js')]);
  const manifest=JSON.parse(manifestSource);
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/');
  assert.ok(manifest.icons.some(icon=>icon.purpose.includes('maskable')));
  assert.match(html,/href="\/app\.css"/);
  assert.match(css,/@media \(max-width:700px\)/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/100dvh/);
  assert.match(worker,/const SHELL_PATHS=new Set\(SHELL\)/);
  assert.match(worker,/!SHELL_PATHS\.has\(url\.pathname\)/);
  assert.doesNotMatch(worker,/pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(worker,/caches\.match\('\/'\)/);
  assert.doesNotMatch(worker,/SHELL=\[[^\]]*\/api\//);
});
