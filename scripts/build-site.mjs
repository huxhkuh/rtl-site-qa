import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function buildSite({ root = process.cwd(), publicDir = 'public', reportDir = 'run-report', repository = process.env.GITHUB_REPOSITORY }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid repository');
  const target = path.resolve(root, publicDir), source = path.resolve(root, reportDir);
  const meta = JSON.parse(await fs.readFile(path.join(source, 'run-meta.json'), 'utf8'));
  const id = `${meta.runId}-${meta.attempt}`;
  if (!/^\d+-\d+$/.test(id)) throw new Error('Run ID must be numeric');
  await fs.mkdir(target, { recursive: true });
  await fs.cp(path.join(root, 'site'), target, { recursive: true });
  let history = [];
  try { history = JSON.parse(await fs.readFile(path.join(target, 'history.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Array.isArray(history)) throw new Error('Invalid existing history');
  const destination = path.join(target, 'reports', id);
  await fs.cp(source, destination, { recursive: true });
  const record = { ...meta, id, report: `reports/${id}/report.html`, json: `reports/${id}/report.json`, actionURL: `https://github.com/${repository}/actions/runs/${meta.runId}` };
  history = [record, ...history.filter(row => row.id !== id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  for (const old of history.slice(20)) if (/^\d+-\d+$/.test(old.id)) await fs.rm(path.join(target, 'reports', old.id), { recursive: true, force: true });
  await fs.writeFile(path.join(target, 'history.json'), JSON.stringify(history.slice(0,20), null, 2));
  await fs.writeFile(path.join(target, 'config.json'), JSON.stringify({ repository, owner: repository.split('/')[0] }));
  await fs.writeFile(path.join(target, '.nojekyll'), '');
  return record;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await buildSite({}));
