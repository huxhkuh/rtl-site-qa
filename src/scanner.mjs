import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { canonical, normalizeConfig, exitCode } from './config.mjs';
import { guardContext, safeGet } from './network.mjs';
import { inspectDOM, inspectKeyboard } from './checks.mjs';
import { screenshot, shotKey, hash, compareScreenshot, scrollToEvidence } from './visual.mjs';
import { writeReport } from './report.mjs';

const array = x => x == null ? [] : Array.isArray(x) ? x : [x];
const shortError = e => String(e.message || e).slice(0, 1500);
const readable = url => new URL(url).pathname;

export async function runScan(input, options = {}) {
  const c = normalizeConfig(input, options.configDir);
  const report = { schemaVersion: 1, runId: new Date().toISOString(), baseURL: c.baseURL, settings: { maxPages: c.maxPages, maxLinks: c.maxLinks, viewports: c.viewports, failOn: c.failOn, exclude: c.exclude, ignoreChecks: c.ignoreChecks, allowedResourceOrigins: c.allowedResourceOrigins },
    pages: [], findings: [], skipped: [], coverage: { sitemapDocuments: 0, linksChecked: 0, urlsVisited: 0, blockedRequests: 0, scenarioMode: 'all-network-blocked-except-exact-mocks', truncated: [] }, incomplete: false };
  await fs.mkdir(c.outDir, { recursive: true });
  const seenFindings = new Map();
  const add = (finding, p) => {
    if (finding.check === 'image-broken' && p?.blocked.some(b => b.url === finding.evidence.src && !b.mocked && b.reason !== 'network-error')) finding = { ...finding, check: 'image-blocked', severity: 'info', evidence: { ...finding.evidence, note: 'התמונה נחסמה בהגדרות הבדיקה; לא ניתן להסיק שהיא חסרה באתר.' } };
    if (c.ignoreChecks.includes(finding.check)) return;
    const f = { page: p?.url || c.baseURL, viewport: p?.viewport || null, state: 'page', severity: 'medium', certainty: 'observed', ...finding };
    const key = JSON.stringify([f.page, f.viewport, f.state, f.check, f.selector, f.evidence]);
    if (seenFindings.has(key)) { seenFindings.get(key).occurrences++; return; }
    f.id = `F${String(report.findings.length + 1).padStart(4, '0')}`; f.occurrences = 1;
    f.reproduction ||= [`פתחו ${f.page}`, `הגדירו רוחב ${f.viewport?.width || 'כללי'} פיקסלים`, ...(f.selector ? [`בדקו את הרכיב ${f.selector}`] : []), `בדיקה: ${f.check}`];
    seenFindings.set(key, f); report.findings.push(f);
  };
  let browser, api;
  const queue = [], queued = new Set(), visited = new Set(), links = new Map();
  const enqueue = (url, from) => {
    const key = canonical(url, from, c);
    if (!key) { if (report.skipped.length < 1000) report.skipped.push({ url, reason: 'scope-or-exclusion-or-scheme' }); return; }
    if (!queued.has(key)) {
      if (queue.length >= c.maxPages) { report.coverage.truncated.push('maxPages'); return; }
      queued.add(key); queue.push(key);
    }
  };
  try {
    browser = options.browser || await chromium.launch({ headless: true });
    report.browser = browser.version(); report.platform = process.platform;
    const apiContext = await browser.newContext({ serviceWorkers: 'block' }); api = apiContext.request;
    for (const url of c.pages) enqueue(url, c.baseURL);
    for (const s of c.scenarios) enqueue(s.page, c.baseURL);
    const sitemapQueue = [...c.sitemap], sitemapSeen = new Set();
    while (sitemapQueue.length && sitemapSeen.size < c.maxSitemaps) {
      const raw = sitemapQueue.shift(), url = canonical(raw, c.baseURL, c);
      if (!url) { report.skipped.push({ url: raw, reason: 'sitemap-out-of-scope-or-excluded' }); continue; }
      if (sitemapSeen.has(url)) continue;
      sitemapSeen.add(url);
      try {
        const r = await safeGet(api, url, c);
        if (!r.response) throw new Error(r.error || r.reason);
        const xml = await r.response.text(); await r.response.dispose();
        if (r.status >= 400 || xml.length > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid, oversized, or unsafe XML sitemap');
        const parsed = new XMLParser({ removeNSPrefix: true }).parse(xml);
        if (!parsed.urlset && !parsed.sitemapindex) throw new Error('Expected urlset or sitemapindex');
        report.coverage.sitemapDocuments++;
        for (const item of array(parsed.urlset?.url)) if (typeof item.loc === 'string') enqueue(item.loc, url);
        for (const item of array(parsed.sitemapindex?.sitemap)) if (typeof item.loc === 'string' && sitemapQueue.length < c.maxSitemaps * 2) sitemapQueue.push(item.loc);
      } catch (e) { report.incomplete = true; add({ check: 'sitemap-error', severity: 'high', evidence: { url, error: shortError(e) } }); }
    }
    if (sitemapQueue.length) report.coverage.truncated.push('maxSitemaps');
    for (let qi = 0; qi < queue.length; qi++) {
      const url = queue[qi]; if (visited.has(url)) continue; visited.add(url);
      options.onProgress?.(`Scanning ${qi + 1}/${queue.length}: ${readable(url)}`);
      for (const viewport of c.viewports) {
        const p = { url, viewport, screenshots: [], scenarios: [], blocked: [], status: 'running' };
        report.pages.push(p);
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block', reducedMotion: 'reduce', acceptDownloads: false });
        const state = { phase: 'scan', mocks: [], prevented: new WeakSet(), closed: false };
        const record = event => { report.coverage.blockedRequests++; if (p.blocked.length < 200) p.blocked.push(event); };
        await guardContext(context, c, state, record);
        const page = await context.newPage(); page.setDefaultTimeout(c.timeoutMs);
        const browserFinding = f => add({ state: state.name || 'page', ...f }, p);
        page.on('pageerror', e => browserFinding({ check: 'javascript-error', severity: 'high', evidence: { message: shortError(e) } }));
        page.on('console', msg => {
          if (msg.type() !== 'error') return;
          const expectedMockError = msg.text().startsWith('Failed to load resource:') && state.mocks.some(m => m.hits && m.status >= 400 && new URL(m.url, c.baseURL).href === msg.location().url);
          if (!expectedMockError) browserFinding({ check: 'console-error', severity: 'medium', evidence: { message: msg.text().slice(0, 1000), location: msg.location() } });
        });
        page.on('response', r => { if (r.status() >= 400 && !state.prevented.has(r.request())) browserFinding({ check: 'http-error', severity: r.request().isNavigationRequest() ? 'high' : 'medium', evidence: { url: r.url(), status: r.status(), type: r.request().resourceType() } }); });
        page.on('requestfailed', r => { if (!state.prevented.has(r)) browserFinding({ check: 'request-failed', severity: 'medium', evidence: { url: r.url(), method: r.method(), error: r.failure()?.errorText } }); });
        page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
        const capture = async name => {
          const key = shotKey(url, viewport, name), file = `screenshots/${key}.png`;
          const fingerprint = hash(JSON.stringify({ browser: report.browser, platform: process.platform, viewport, masks: c.maskSelectors, locale: 'he-IL', timezone: 'Asia/Jerusalem', reducedMotion: 'reduce', deviceScaleFactor: 1 }));
          await screenshot(page, path.join(c.outDir, file), c);
          const visual = await compareScreenshot(path.join(c.outDir, file), key, fingerprint, c);
          const shot = { key, state: name, file, fingerprint, visual }; p.screenshots.push(shot);
          if (visual.status === 'changed') add({ check: 'visual-change', severity: 'medium', certainty: 'suspected', state: name, screenshot: file, evidence: visual }, p);
          if (['invalid-baseline', 'incompatible-baseline'].includes(visual.status)) { report.incomplete = true; add({ check: 'baseline-unusable', severity: 'medium', state: name, evidence: visual }, p); }
          return file;
        };
        const load = async () => {
          state.phase = 'scan'; state.name = undefined; state.mocks = [];
          const resolved = await safeGet(api, url, c);
          if (!resolved.response) throw new Error(`Navigation preflight: ${resolved.error || resolved.reason}`);
          await resolved.response.dispose(); state.documentURL = resolved.url;
          const response = await page.goto(resolved.url, { waitUntil: 'domcontentloaded', timeout: c.timeoutMs });
          p.httpStatus = response?.status(); p.finalURL = page.url();
          await page.waitForTimeout(c.settleMs);
          await page.evaluate(async timeout => { await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, timeout))]); }, c.timeoutMs);
        };
        try {
          await load();
          // Bounded scrolling activates ordinary lazy-loaded images without infinite-page loops.
          let scrollComplete = false;
          for (let i = 0; i < c.maxScrollSteps; i++) {
            scrollComplete = await page.evaluate(() => { window.scrollBy({ top: Math.max(200, innerHeight * 0.8), behavior: 'instant' }); return scrollY + innerHeight >= document.documentElement.scrollHeight - 2; });
            await page.waitForTimeout(70); if (scrollComplete) break;
          }
          p.scrollComplete = scrollComplete;
          if (!scrollComplete) report.coverage.truncated.push('maxScrollSteps');
          await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); await page.waitForTimeout(c.settleMs);
          const dom = await page.evaluate(inspectDOM); p.title = dom.title; p.direction = dom.direction;
          for (const f of dom.findings) add(f, p);
          for (const link of dom.anchors) {
            const target = canonical(link.href, page.url(), c); if (!target) continue;
            const parsed = new URL(link.href);
            if (parsed.hash && target === canonical(page.url(), url, c)) {
              let id; try { id = decodeURIComponent(parsed.hash.slice(1)); } catch { id = parsed.hash.slice(1); }
              if (id && !await page.evaluate(id => !!document.getElementById(id) || [...document.getElementsByName(id)].length > 0, id)) add({ check: 'broken-fragment', severity: 'medium', selector: link.selector, evidence: { url: link.href } }, p);
            }
            if (!links.has(target)) {
              if (links.size < c.maxLinks) links.set(target, []); else { report.coverage.truncated.push('maxLinks'); continue; }
            }
            links.get(target).push({ page: p, selector: link.selector });
            if (c.crawl && !/\.(?:pdf|zip|png|jpe?g|svg|gif|webp|mp[34]|woff2?)(?:$|\?)/i.test(target)) enqueue(target, url);
          }
          const mainShot = await capture('page');
          // Keyboard event handlers also run under the network lock.
          state.phase = 'keyboard';
          let focusShots = 0;
          const keyboard = await inspectKeyboard(page, c.keyboardSteps, async (f, index) => {
            if (f.check === 'focus-invisible' && focusShots++ < 8) { const file = `screenshots/${shotKey(url, viewport, `focus-${index}`)}-focus.png`; await screenshot(page, path.join(c.outDir, file), c); f.screenshot = file; }
          }); p.keyboard = keyboard.visited;
          for (const f of keyboard.findings) add({ ...f, reproduction: [`פתחו ${url} ברוחב ${viewport.width}`, `לחצו Tab ${f.evidence.tabNumber} פעמים מתחילת העמוד`, `בדקו את המיקוד ברכיב ${f.selector}`] }, p);
          const relevant = report.findings.filter(f => f.page === url && f.viewport === viewport && f.selector && ['horizontal-scroll', 'outside-viewport', 'text-clipping', 'image-broken'].includes(f.check)).slice(0, 8);
          for (const f of relevant) {
            try { await scrollToEvidence(page.locator(f.selector).first()); const file = `screenshots/${shotKey(url, viewport, f.id)}-evidence.png`; await screenshot(page, path.join(c.outDir, file), c); f.screenshot = file; }
            catch { f.screenshot = mainShot; }
          }
          for (const f of report.findings.filter(f => f.page === url && f.viewport === viewport)) f.screenshot ||= mainShot;
          for (const s of c.scenarios.filter(s => canonical(s.page, c.baseURL, c) === url && (!s.widths || s.widths.includes(viewport.width)))) {
            await load(); state.phase = 'scenario'; state.name = s.name; state.mocks = structuredClone(s.mocks || []);
            const result = { name: s.name, status: 'passed', steps: [], mockedRequests: [] }; p.scenarios.push(result);
            try {
              for (let i = 0; i < s.steps.length; i++) {
                const step = s.steps[i], locator = page.locator(step.selector);
                result.steps.push({ number: i + 1, action: step.action, selector: step.selector });
                switch (step.action) {
                  case 'click': await locator.click(); break;
                  case 'fill': await locator.fill(step.value); break;
                  case 'press': await locator.press(step.value); break;
                  case 'expectVisible': await expect(locator).toBeVisible({ timeout: c.timeoutMs }); break;
                  case 'expectHidden': await expect(locator).toBeHidden({ timeout: c.timeoutMs }); break;
                  case 'expectText': await expect(locator).toContainText(step.value, { timeout: c.timeoutMs }); break;
                  case 'expectAttribute': await expect(locator).toHaveAttribute(step.attribute, step.value, { timeout: c.timeoutMs }); break;
                  case 'expectFocused': await expect(locator).toBeFocused({ timeout: c.timeoutMs }); break;
                }
              }
              for (const mock of state.mocks) if (mock.required !== false && !mock.hits) throw new Error(`Required mock was never requested: ${mock.method} ${mock.url}`);
            } catch (e) {
              result.status = 'failed'; result.error = shortError(e);
              add({ check: 'scenario-failed', severity: 'high', state: s.name, evidence: { error: result.error, step: result.steps.at(-1) }, reproduction: [`פתחו ${url} ברוחב ${viewport.width}`, 'הפעילו חסימת רשת ותשובות דמה לפי קובץ ההגדרות', ...s.steps.map((st, i) => `${i + 1}. ${st.action}: ${st.selector}`)] }, p);
            }
            result.mockedRequests = state.mocks.map(m => ({ method: m.method, url: m.url, hits: m.hits || 0 }));
            const findings = await page.evaluate(inspectDOM);
            for (const f of findings.findings) add({ ...f, state: s.name }, p);
            result.screenshot = await capture(s.name);
            for (const f of report.findings.filter(f => f.page === url && f.viewport === viewport && f.state === s.name)) f.screenshot ||= result.screenshot;
          }
          p.status = 'completed';
        } catch (e) { p.status = 'incomplete'; report.incomplete = true; add({ check: 'page-check-error', severity: 'high', state: state.name || 'page', evidence: { error: shortError(e) } }, p); try { await capture('error'); } catch { /* browser may be unavailable */ } }
        finally { state.closed = true; state.phase = 'closed'; await context.close(); }
      }
    }
    for (const [url, sources] of links) {
      report.coverage.linksChecked++;
      try {
        const r = await safeGet(api, url, c);
        if (r.blocked) { report.skipped.push({ url, reason: r.reason, finalURL: r.url }); continue; }
        if (r.error || r.status >= 400) for (const source of sources) add({ check: 'broken-link', severity: 'high', selector: source.selector, screenshot: source.page.screenshots[0]?.file, evidence: { target: url, finalURL: r.url, status: r.status, error: r.error } }, source.page);
        await r.response?.dispose();
      } catch (e) { for (const source of sources) add({ check: 'link-unverified', severity: 'medium', certainty: 'suspected', selector: source.selector, evidence: { target: url, error: shortError(e) } }, source.page); report.incomplete = true; }
    }
    report.coverage.urlsVisited = visited.size;
    if (!visited.size) { report.incomplete = true; add({ check: 'no-pages', severity: 'high', evidence: { reason: 'All inputs empty, excluded, or outside scope' } }); }
    await apiContext.close();
  } catch (e) { report.fatal = shortError(e); report.incomplete = true; }
  finally { if (browser && !options.browser) await browser.close(); }
  report.coverage.truncated = [...new Set(report.coverage.truncated)];
  report.finishedAt = new Date().toISOString(); report.exitCode = exitCode(report, c.failOn);
  await writeReport(report, c.outDir);
  return report;
}
