import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startFixture } from '../fixture/server.mjs';
import { runScan } from '../src/scanner.mjs';
const c = JSON.parse(await fs.readFile(new URL('./fixture.config.json', import.meta.url), 'utf8'));
const server = await startFixture({ port: 4173 });
try {
  const report = await runScan(c, { configDir: fileURLToPath(new URL('.', import.meta.url)), onProgress: console.log });
  console.log(JSON.stringify({ exitCode: report.exitCode, findings: report.findings.length, realMutations: server.mutations.length, report: 'sample-report/report.html' }, null, 2));
  process.exitCode = report.exitCode;
} finally { await server.close(); }
