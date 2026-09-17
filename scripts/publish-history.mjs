import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { buildSite } from './build-site.mjs';

const repo = process.env.GITHUB_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('Invalid repository');
const url = `https://github.com/${repo}.git`;
const git = args => execFileSync('git', args, { stdio: 'inherit' });
const refs = execFileSync('git', ['ls-remote', '--heads', url, 'gh-pages'], { encoding: 'utf8' });
if (refs.trim()) git(['clone','--depth','1','--branch','gh-pages',url,'public']);
else {
  await fs.mkdir('public', { recursive: true });
  git(['-C','public','init','-b','gh-pages']);
  git(['-C','public','remote','add','origin',url]);
}
await buildSite({});
git(['-C','public','config','user.name','github-actions[bot]']);
git(['-C','public','config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
git(['-C','public','add','--all']);
git(['-C','public','commit','-m',`Publish QA report ${process.env.GITHUB_RUN_ID}`]);
git(['-C','public','-c','credential.helper=!gh auth git-credential','push','origin','HEAD:gh-pages']);
