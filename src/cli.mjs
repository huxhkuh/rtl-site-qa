#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runScan } from './scanner.mjs';
import { approveBaseline } from './visual.mjs';

try {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, base: { type: 'string' }, pages: { type: 'string' }, sitemap: { type: 'string' }, out: { type: 'string' }, 'fail-on': { type: 'string' },
    'max-pages': { type: 'string' }, report: { type: 'string' }, baselines: { type: 'string' }, by: { type: 'string' }, keys: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (v.help) {
    console.log('RTL QA\nnode src/cli.mjs scan --config qa.config.json [--base URL] [--pages /,/about] [--sitemap /sitemap.xml] [--out runs/name] [--max-pages 20] [--fail-on high]\nnode src/cli.mjs approve --report runs/name/report.json --baselines baselines --by reviewer --keys key1,key2\nExit: 0 below threshold; 1 findings; 2 incomplete/config/runtime error.');
  } else if (positionals[0] === 'approve') {
    if (!v.report || !v.baselines) throw new Error('approve requires --report and --baselines');
    const count = await approveBaseline(v.report, path.resolve(v.baselines), v.by, v.keys?.split(',')); console.log(`Approved ${count} screenshots.`);
  } else if (!positionals[0] || positionals[0] === 'scan') {
    const configPath = v.config ? path.resolve(v.config) : null;
    const config = configPath ? JSON.parse(await fs.readFile(configPath, 'utf8')) : {};
    if (v.base) config.baseURL = v.base;
    if (v.pages) config.pages = v.pages.split(',');
    if (v.sitemap) config.sitemap = v.sitemap;
    if (v.out) config.outDir = path.resolve(v.out);
    if (v['fail-on']) config.failOn = v['fail-on'];
    if (v['max-pages']) config.maxPages = Number(v['max-pages']);
    const r = await runScan(config, { configDir: configPath ? path.dirname(configPath) : process.cwd(), onProgress: console.log });
    console.log(JSON.stringify({ exitCode: r.exitCode, pages: r.coverage.urlsVisited, viewportChecks: r.pages.length, findings: r.findings.length, incomplete: r.incomplete, fatal: r.fatal, outDir: config.outDir || 'runs/<timestamp>' }, null, 2));
    process.exitCode = r.exitCode;
  } else throw new Error(`Unknown command: ${positionals[0]}`);
} catch (e) { console.error(`RTL QA: ${e.message}`); process.exitCode = 2; }
