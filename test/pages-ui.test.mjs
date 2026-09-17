import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { serveDirectory } from '../src/serve.mjs';
import { parseIssue } from '../scripts/request.mjs';

test('Pages form, error state, history and authenticated handoff work at mobile and desktop widths', {timeout:60000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'rtl-pages-ui-'));
  await fs.cp(fileURLToPath(new URL('../site',import.meta.url)),root,{recursive:true});
  await fs.writeFile(path.join(root,'config.json'),JSON.stringify({repository:'owner/rtl-site-qa',owner:'owner'}));
  await fs.writeFile(path.join(root,'history.json'),JSON.stringify([{id:'123-1',createdAt:'2026-09-17T00:00:00Z',baseURL:'https://example.com/<script>alert(1)</script>',exitCode:1,pages:2,findings:3,report:'reports/123-1/report.html',json:'reports/123-1/report.json'}]));
  const server = await serveDirectory(root); t.after(()=>server.close());
  const browser = await chromium.launch(); t.after(()=>browser.close());
  for (const width of [390,1440]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors = []; page.on('pageerror',e=>errors.push(e.message));
    let handedOff;
    await page.route('https://github.com/**',async route=>{handedOff=route.request().url();await route.fulfill({status:200,contentType:'text/html',body:'GitHub request preview'});});
    await page.goto(server.baseURL);
    await page.locator('#submit:enabled').waitFor();
    await page.locator('#history tr').waitFor();
    assert.equal(await page.locator('#history script').count(),0);
    assert.ok((await page.locator('#history').innerText()).includes('<script>'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.fill('#base-url','https://example.com');
    await page.check('#consent');
    await page.locator('summary').click();
    await page.fill('#advanced','{bad json}');
    await page.click('#submit');
    assert.ok((await page.locator('#form-status').innerText()).includes('JSON'));
    assert.equal(handedOff,undefined);
    await page.fill('#advanced','{"scenarios":[]}');
    await page.click('#submit');
    await page.waitForURL('https://github.com/**');
    const target=new URL(handedOff);
    assert.equal(target.pathname,'/owner/rtl-site-qa/issues/new');
    assert.equal(parseIssue(target.searchParams.get('body')).baseURL,'https://example.com/');
    assert.deepEqual(errors,[]);
    await page.close();
  }
});
