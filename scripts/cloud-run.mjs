import fs from 'node:fs/promises';
import { runScan } from '../src/scanner.mjs';
import { startFixture } from '../fixture/server.mjs';
import { parseIssue, cloudConfig } from './request.mjs';

const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
const eventName = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch';
let report, fixture, demonstration = false;
try {
  let input;
  if (eventName === 'issues') {
    if (event.issue?.user?.login !== process.env.GITHUB_REPOSITORY_OWNER || !event.issue.title.startsWith('[RTL QA] ')) throw new Error('Only the repository owner can request a scan');
    input = parseIssue(event.issue.body);
  } else if ((process.env.REQUEST_JSON || '').trim()) input = JSON.parse(process.env.REQUEST_JSON);
  if (input) report = await runScan(await cloudConfig(input), { onProgress: console.log });
  else {
    demonstration = true;
    fixture = await startFixture({ port: 4173 });
    const config = JSON.parse(await fs.readFile('examples/fixture.config.json', 'utf8'));
    report = await runScan({ ...config, baseURL: fixture.baseURL, timeoutMs: 5000, outDir: 'run-report', baselineDir: 'baselines' }, { onProgress: console.log });
    if (fixture.mutations.length) throw new Error('A fixture mutation unexpectedly reached the server');
  }
  const result = { runId: process.env.GITHUB_RUN_ID || 'local', attempt: process.env.GITHUB_RUN_ATTEMPT || '1', createdAt: new Date().toISOString(), baseURL: report.baseURL, exitCode: report.exitCode, demonstration, issue: event.issue?.number || null, pages: report.coverage.urlsVisited, viewportChecks: report.pages.length, findings: report.findings.length, suspects: report.findings.filter(f => f.certainty === 'suspected').length };
  await fs.writeFile('run-report/run-meta.json', JSON.stringify(result, null, 2));
  await fs.writeFile('scan-result.json', JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `exit_code=${demonstration ? 0 : report.exitCode}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `## RTL QA\n\n${result.pages} pages / ${result.viewportChecks} viewport checks / ${result.findings} findings.\n\nScanner exit code: ${result.exitCode}${demonstration ? ' (intentional demonstration defects)' : ''}.\n\nThe report is published by the deployment job, including when the quality threshold is exceeded.\n`);
  console.log(JSON.stringify(result));
} finally { await fixture?.close(); }
