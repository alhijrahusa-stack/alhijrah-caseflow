import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addUser,
  backend,
  browserHeaders,
  cookieHeader,
  driver,
  resetBackend,
} from './helpers/harness.js';
import { handle, respondToError } from '../src/server.js';

const request=driver(handle,respondToError);

async function signIn(email='staff@caseflow.test'){
  const response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email,password:'correct-horse-battery'}});
  assert.equal(response.status,200,response.raw);
  return cookieHeader(response.cookies);
}

test.beforeEach(()=>resetBackend());

test('ordinary authenticated requests use only the anon key plus the user JWT',async()=>{
  addUser({email:'staff@caseflow.test',roles:['case_manager']});
  const cookie=await signIn();
  backend.restRequests=[];
  const response=await request({path:'/api/v1/cases',headers:browserHeaders({cookie})});
  assert.equal(response.status,200,response.raw);
  assert.ok(backend.restRequests.length>0);
  for(const databaseRequest of backend.restRequests){
    assert.equal(databaseRequest.headers.apikey,'anon-key');
    assert.match(databaseRequest.headers.authorization,/^Bearer access-/);
    assert.notEqual(databaseRequest.headers.authorization,'Bearer service-role-key');
  }
});

test('a user database denial fails closed without service-role retry',async()=>{
  addUser({email:'staff@caseflow.test',roles:['case_manager']});
  const cookie=await signIn();
  backend.restRequests=[];
  backend.failNextUserDatabaseRequest=1;
  const response=await request({path:'/api/v1/cases',headers:browserHeaders({cookie})});
  assert.equal(response.status,503,response.raw);
  assert.equal(backend.restRequests.length,1);
  assert.equal(backend.restRequests[0].headers.apikey,'anon-key');
  assert.equal(backend.restRequests.some(entry=>entry.headers.apikey==='service-role-key'),false);
});

test('an expired user token refreshes to a user JWT and never invokes service role',async()=>{
  addUser({email:'staff@caseflow.test',roles:['case_manager']});
  const validCookie=await signIn();
  const expiredCookie=validCookie.replace(/__Host-caseflow_access=[^;]+/,'__Host-caseflow_access=expired-user-token');
  backend.restRequests=[];
  const response=await request({path:'/api/v1/cases',headers:browserHeaders({cookie:expiredCookie})});
  assert.equal(response.status,200,response.raw);
  assert.ok(backend.restRequests.length>0);
  assert.equal(backend.restRequests.some(entry=>entry.headers.apikey==='service-role-key'),false);
  assert.equal(backend.restRequests.every(entry=>entry.headers.apikey==='anon-key'&&/^Bearer access-/.test(entry.headers.authorization)),true);
});

test('explicitly trusted readiness operations retain the system boundary',async()=>{
  const response=await request({path:'/ready'});
  assert.ok([200,503].includes(response.status),response.raw);
  const systemRequests=backend.restRequests.filter(entry=>entry.path.startsWith('/rest/v1/'));
  assert.ok(systemRequests.length>0);
  assert.equal(systemRequests.every(entry=>entry.headers.apikey==='service-role-key'&&entry.headers.authorization==='Bearer service-role-key'),true);
});
