import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { normalizeConfig, canonical, exitCode } from '../src/config.mjs';
import { runScan } from '../src/scanner.mjs';
import { safeGet, guardContext } from '../src/network.mjs';
import { compareScreenshot, approveBaseline, scrollToEvidence } from '../src/visual.mjs';
import { escapeHTML } from '../src/report.mjs';
import { startFixture } from '../fixture/server.mjs';
import { serveDirectory } from '../src/serve.mjs';
import { inspectDOM, inspectKeyboard } from '../src/checks.mjs';

test('scope, query canonicalization, exclusions, credentials, and bounds', () => {
  const c = normalizeConfig({ baseURL: 'https://site.example' });
  assert.equal(canonical('/a?z=2&b=1&utm_source=x#id', c.baseURL, c), 'https://site.example/a?b=1&z=2');
  for (const value of ['https://other.example/', 'https://site.example.evil/', 'http://site.example/', '//sub.site.example/', 'https://user:pass@site.example/', '/%64elete?id=3', '/logout', 'javascript:alert(1)']) assert.equal(canonical(value, c.baseURL, c), null, value);
  assert.throws(() => normalizeConfig({ baseURL: c.baseURL, maxPages: 0 }));
  assert.throws(() => normalizeConfig({ baseURL: c.baseURL, visual: { maxDiffRatio: 2 } }));
  assert.throws(() => normalizeConfig({ baseURL: c.baseURL, scenarios: [{ name: 'bad', page: '/', steps: [{ action: 'evaluate', selector: 'body' }] }] }));
  assert.throws(() => normalizeConfig({ baseURL: c.baseURL, scenarios: [{ name: 'page', page: '/', steps: [{ action: 'click', selector: 'button' }] }] }));
  assert.equal(exitCode({ findings: [{ severity: 'high', certainty: 'suspected' }] }, 'high'), 0);
  assert.equal(exitCode({ findings: [{ severity: 'high', certainty: 'observed' }] }, 'high'), 1);
  assert.equal(exitCode({ incomplete: true, findings: [] }, 'none'), 2);
  assert.equal(escapeHTML('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('deliberate defects, healthy control, sitemap loop, 3 widths, scenarios, and real-mutation sentinel', { timeout: 120000 }, async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtl-qa-tests-'));
  const source = JSON.parse(await fs.readFile(new URL('../examples/fixture.config.json', import.meta.url), 'utf8'));
  const r = await runScan({ ...source, baseURL: fixture.baseURL, outDir, baselineDir: path.join(outDir, 'baseline'), timeoutMs: 5000, settleMs: 100, keyboardSteps: 4 });
  assert.equal(r.incomplete, false, r.fatal || JSON.stringify(r.findings.filter(f => f.check === 'page-check-error')));
  assert.equal(r.exitCode, 1);
  assert.equal(r.coverage.urlsVisited, 2); assert.equal(r.pages.length, 6); assert.equal(r.coverage.sitemapDocuments, 2);
  const checks = new Set(r.findings.map(f => f.check));
  for (const check of ['horizontal-scroll', 'outside-viewport', 'text-clipping', 'image-broken', 'image-alt-missing', 'form-label-missing', 'keyboard-unreachable', 'heading-skip', 'javascript-error', 'request-failed', 'http-error', 'broken-link', 'broken-fragment', 'scenario-failed']) assert.ok(checks.has(check), check);
  assert.ok(r.findings.filter(f => f.check === 'text-clipping').every(f => f.certainty === 'suspected'));
  assert.ok(r.findings.every(f => f.page && f.severity && f.reproduction.length && f.evidence));
  for (const p of r.pages.filter(p => new URL(p.url).pathname === '/')) {
    assert.equal(p.scenarios.find(s => s.name === 'תפריט שבור').status, 'failed');
    assert.equal(p.scenarios.find(s => s.name === 'תפריט תקין').status, 'passed');
    assert.equal(p.scenarios.find(s => s.name === 'שאלות נפוצות במקלדת').status, 'passed');
    const form = p.scenarios.find(s => s.name === 'טופס עם הדמיה בלבד');
    assert.equal(form.status, 'passed', form.error); assert.equal(form.mockedRequests[0].hits, 1);
  }
  const healthy = r.findings.filter(f => new URL(f.page).pathname === '/clean');
  assert.equal(healthy.length, 0, JSON.stringify(healthy));
  assert.equal(fixture.mutations.length, 0); assert.ok(!fixture.hits.some(h => h.path === '/logout'));
  assert.ok((await fs.readFile(path.join(outDir, 'report.html'), 'utf8')).includes('dir="rtl"'));
  for (const p of r.pages) for (const s of p.screenshots) { assert.ok((await fs.stat(path.join(outDir, s.file))).size > 100); assert.equal(s.visual.status, 'no-approved-baseline'); }
});

test('network guard blocks GET/POST actions, external resources, popups and redirect chains', { timeout: 30000 }, async t => {
  let externalHits = 0;
  const external = http.createServer((req, res) => { externalHits++; res.end('sentinel'); });
  await new Promise(resolve => external.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { external.close(resolve); external.closeAllConnections(); }));
  const externalURL = `http://127.0.0.1:${external.address().port}`;
  const fixture = await startFixture({ externalURL }); t.after(() => fixture.close());
  const c = normalizeConfig({ baseURL: fixture.baseURL, timeoutMs: 5000 });
  const browser = await chromium.launch(); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const state = { phase: 'scan', prevented: new WeakSet(), mocks: [] }, events = [];
  await guardContext(context, c, state, e => events.push(e));
  let page = await context.newPage(); await page.goto(fixture.baseURL + '/clean');
  await page.evaluate(url => { const img = new Image(); img.src = url + '/pixel'; document.body.append(img); }, externalURL);
  await page.goto(fixture.baseURL + '/redirect-chain').catch(() => {});
  const r = await safeGet(context.request, fixture.baseURL + '/redirect-chain', c); assert.equal(r.blocked, true);
  const loop = await safeGet(context.request, fixture.baseURL + '/loop', c); assert.equal(loop.error, 'redirect-loop');
  await page.close(); page = await context.newPage();
  await page.goto(fixture.baseURL + '/clean'); state.phase = 'scenario';
  await page.evaluate(async base => { await Promise.all([fetch(base + '/danger').catch(()=>{}), fetch(base + '/submit', { method: 'POST' }).catch(()=>{}), fetch(base + '/clean', { method: 'PUT' }).catch(()=>{})]); window.open(base + '/danger'); }, fixture.baseURL);
  await page.waitForTimeout(100);
  assert.equal(fixture.mutations.length, 0); assert.equal(externalHits, 0);
  assert.ok(events.some(e => e.reason === 'browser-redirect-blocked')); assert.ok(events.some(e => e.method === 'POST' && e.reason === 'scenario-network-lock'));
  await context.close();
});

test('visual baseline requires named approval, validates hash, detects real pixel changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rtl-qa-visual-')), key = '0123456789abcdefabcd';
  await fs.mkdir(path.join(root, 'screenshots'));
  const file = path.join(root, 'screenshots', `${key}.png`), baselineDir = path.join(root, 'baselines');
  const png = new PNG({ width: 20, height: 20 }); png.data.fill(255); await fs.writeFile(file, PNG.sync.write(png));
  const c = normalizeConfig({ baseURL: 'http://localhost', outDir: root, baselineDir });
  assert.equal((await compareScreenshot(file, key, 'environment', c)).status, 'no-approved-baseline');
  const reportFile = path.join(root, 'report.json');
  await fs.writeFile(reportFile, JSON.stringify({ pages: [{ screenshots: [{ key, file: `screenshots/${key}.png`, fingerprint: 'environment' }] }] }));
  await assert.rejects(approveBaseline(reportFile, baselineDir, '', [key]));
  await approveBaseline(reportFile, baselineDir, 'Automated fixture baseline test', [key]);
  assert.equal((await compareScreenshot(file, key, 'environment', c)).status, 'matched');
  png.data.fill(0); for (let i=3;i<png.data.length;i+=4) png.data[i]=255;
  await fs.writeFile(file, PNG.sync.write(png));
  assert.equal((await compareScreenshot(file, key, 'environment', c)).status, 'changed');
  assert.equal((await compareScreenshot(file, key, 'different-environment', c)).status, 'incompatible-baseline');
  await fs.writeFile(path.join(baselineDir, `${key}.png`), PNG.sync.write(png));
  assert.equal((await compareScreenshot(file, key, 'environment', c)).status, 'invalid-baseline');
});

test('caps, exclusions and invalid sitemap produce honest coverage and exit codes', { timeout: 30000 }, async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtl-qa-limits-'));
  const common = { baseURL: fixture.baseURL, pages: ['/clean'], viewports: [{ width: 390, height: 844 }], keyboardSteps: 0, settleMs: 0, timeoutMs: 5000, outDir, visual: { enabled: false } };
  const clean = await runScan(common); assert.equal(clean.exitCode, 0); assert.equal(clean.incomplete, false);
  const limited = await runScan({ ...common, pages: ['/clean', '/'], maxPages: 1 });
  assert.equal(limited.coverage.urlsVisited, 1); assert.ok(limited.coverage.truncated.includes('maxPages'));
  const invalid = await runScan({ ...common, sitemap: '/evil.xml', failOn: 'none' });
  assert.equal(invalid.exitCode, 2); assert.ok(invalid.findings.some(f => f.check === 'sitemap-error'));
  const none = await runScan({ ...common, pages: ['/logout'] }); assert.equal(none.exitCode, 2);
});

test('clipped body is not page scrolling; invisible ancestors and animated skip links are not false positives', async t => {
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent('<html lang="he" dir="rtl"><style>html,body{overflow-x:hidden;margin:0}.skip{position:fixed;top:-100px;transition:top .15s}.skip:focus{top:10px}</style><body><a class="skip" href="#main">דילוג לתוכן</a><main id="main"><h1>תקין</h1><div style="width:450px">רכיב פנימי רחב</div><div style="opacity:0"><img src="missing.png"><div style="width:500px">לא מוצג</div></div></main></body></html>');
  const dom = await page.evaluate(inspectDOM);
  assert.ok(!dom.findings.some(f => f.check === 'horizontal-scroll'));
  assert.ok(!dom.findings.some(f => f.check === 'image-broken'));
  await scrollToEvidence(page.locator('#main > div').first());
  assert.equal(await page.evaluate(() => document.body.scrollLeft), 0);
  const keyboard = await inspectKeyboard(page, 1);
  assert.ok(!keyboard.findings.some(f => f.check === 'focus-invisible'), JSON.stringify(keyboard.findings));
});

test('static preview serves GIFs and rejects mutations and private file paths', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rtl-qa-static-'));
  await fs.writeFile(path.join(root, 'image.gif'), Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  await fs.writeFile(path.join(root, '.private.json'), '{}');
  const server = await serveDirectory(root); t.after(() => server.close());
  const response = await fetch(server.baseURL + '/image.gif');
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/gif');
  assert.equal((await fetch(server.baseURL + '/image.gif', { method: 'POST' })).status, 405);
  assert.equal((await fetch(server.baseURL + '/.private.json')).status, 404);
});
