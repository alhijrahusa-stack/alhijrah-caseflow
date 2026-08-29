import test from 'node:test';
import assert from 'node:assert/strict';
import {probeOfficialSource,validateOfficialSourceUrl} from '../src/form-source-monitor.js';

test('official source monitor rejects SSRF and non-government hosts',()=>{
  for(const url of ['http://uscis.gov/form.pdf','https://127.0.0.1/form.pdf','https://example.com/form.pdf'])assert.throws(()=>validateOfficialSourceUrl(url));
  assert.equal(validateOfficialSourceUrl('https://www.uscis.gov/i-130').hostname,'www.uscis.gov');
});

test('official source monitor preserves validators and hashes changed bytes',async()=>{
  let headers;const fetchImpl=async(_url,options)=>{headers=options.headers;return new Response(Buffer.from('%PDF-official'),{status:200,headers:{etag:'"v2"','last-modified':'Fri, 28 Aug 2026 00:00:00 GMT','content-type':'application/pdf'}})};
  const result=await probeOfficialSource({url:'https://travel.state.gov/form.pdf',etag:'"v1"',lastModified:'Thu, 27 Aug 2026 00:00:00 GMT',fetchImpl});
  assert.equal(headers['if-none-match'],'"v1"');assert.equal(result.sha256.length,64);assert.equal(result.changed,true);
});
