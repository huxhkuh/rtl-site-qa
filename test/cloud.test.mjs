import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIssue, publicURL, cloudConfig, isPublicAddress } from '../scripts/request.mjs';
import { buildSite } from '../scripts/build-site.mjs';
import { makeRequest } from '../site/request-link.mjs';

test('Pages request round-trips through the authenticated GitHub issue without executing text', () => {
  const request = makeRequest({ repository: 'owner/rtl-site-qa', baseURL: 'https://example.com', pages: '/\n/about', sitemap: '', maxPages: 10, failOn: 'high', crawl: true, advanced: '{"scenarios":[]}' });
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://github.com'); assert.equal(url.pathname, '/owner/rtl-site-qa/issues/new');
  assert.equal(url.searchParams.get('title'), '[RTL QA] example.com');
  assert.deepEqual(parseIssue(url.searchParams.get('body')), request.config);
  assert.throws(() => parseIssue('missing JSON'));
  assert.throws(() => makeRequest({ repository:'owner/rtl-site-qa',baseURL:'javascript:alert(1)',pages:'/',advanced:'',maxPages:10 }));
});

test('cloud request rejects private addresses, credentials, paths and unbounded jobs', async () => {
  const goodDNS = async () => [{ address: '93.184.216.34', family: 4 }];
  const privateDNS = async () => [{ address: '127.0.0.1', family: 4 }];
  for (const address of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','fd00::1']) assert.equal(isPublicAddress(address), false, address);
  for (const value of ['http://127.0.0.1','http://localhost','https://example.local','https://user:secret@example.com','http://example.com:8080']) await assert.rejects(publicURL(value, goodDNS));
  await assert.rejects(publicURL('https://example.com', privateDNS));
  await assert.rejects(cloudConfig({ baseURL:'https://example.com',outDir:'../../outside' }, goodDNS));
  await assert.rejects(cloudConfig({ baseURL:'https://example.com',maxPages:100 }, goodDNS));
  const config = await cloudConfig({baseURL:'https://example.com',pages:['/'],maxPages:2},goodDNS);
  assert.equal(config.outDir,'run-report'); assert.equal(config.maxPages,2);
});

test('Pages publishing preserves report history, copies evidence and prevents path traversal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'rtl-cloud-test-'));
  await fs.cp(fileURLToPath(new URL('../site',import.meta.url)),path.join(root,'site'),{recursive:true});
  await fs.mkdir(path.join(root,'run-report/screenshots'),{recursive:true});
  await fs.writeFile(path.join(root,'run-report/report.html'),'<html lang="he">report</html>');
  await fs.writeFile(path.join(root,'run-report/report.json'),'{}');
  await fs.writeFile(path.join(root,'run-report/screenshots/evidence.png'),'test');
  const metadata = {runId:'100',attempt:'1',createdAt:'2026-09-17T01:00:00Z',baseURL:'https://example.com',exitCode:1};
  await fs.writeFile(path.join(root,'run-report/run-meta.json'),JSON.stringify(metadata));
  await buildSite({root,repository:'owner/repo'});
  await fs.writeFile(path.join(root,'run-report/run-meta.json'),JSON.stringify({...metadata,runId:'101',createdAt:'2026-09-17T02:00:00Z'}));
  await buildSite({root,repository:'owner/repo'});
  const history=JSON.parse(await fs.readFile(path.join(root,'public/history.json'),'utf8'));
  assert.deepEqual(history.map(x=>x.id),['101-1','100-1']);
  assert.ok((await fs.stat(path.join(root,'public/reports/100-1/screenshots/evidence.png'))).size);
  const source=await fs.readFile(path.join(root,'public/app.mjs'),'utf8');
  assert.ok(source.includes('textContent')); assert.ok(!source.includes('innerHTML'));
  await fs.writeFile(path.join(root,'run-report/run-meta.json'),JSON.stringify({...metadata,runId:'../../outside'}));
  await assert.rejects(buildSite({root,repository:'owner/repo'}));
});
