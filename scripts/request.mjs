import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeConfig } from '../src/config.mjs';

export function parseIssue(body) {
  if (typeof body !== 'string' || body.length > 30000) throw new Error('Invalid request size');
  const match = body.match(/```json\s*([\s\S]*?)```/);
  if (!match) throw new Error('The request must contain one JSON code block');
  return JSON.parse(match[1]);
}
export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18,19].includes(b)));
  }
  const value = address.toLowerCase();
  return isIP(value) === 6 && !value.startsWith('::') && !/^(fc|fd|fe[89ab]|ff)/.test(value);
}
export async function publicURL(raw, resolver = lookup) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || (url.port && !['80','443'].includes(url.port))) throw new Error('Use a public HTTP(S) URL on a standard port, without credentials or fragment');
  if (!url.hostname.includes('.') || isIP(url.hostname.replace(/[\[\]]/g,'')) || /\.(localhost|local|internal|test|invalid)$/i.test(url.hostname)) throw new Error('Cloud scans require a public domain name');
  const records = await resolver(url.hostname, { all: true });
  if (!records.length || records.some(r => !isPublicAddress(r.address))) throw new Error('Private, loopback and link-local addresses are not allowed for cloud scans');
  return url.href;
}
export async function cloudConfig(input, resolver) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be a JSON object');
  const allowed = new Set(['baseURL','pages','sitemap','crawl','maxPages','maxLinks','exclude','failOn','allowedResourceOrigins','scenarios','maskSelectors','settleMs']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Unsupported cloud option: ${key}`);
  const baseURL = await publicURL(input.baseURL, resolver);
  for (const origin of input.allowedResourceOrigins || []) await publicURL(origin, resolver);
  if ((input.maxPages ?? 10) > 30 || (input.maxLinks ?? 100) > 300 || (input.scenarios?.length || 0) > 10) throw new Error('Cloud limits: 30 pages, 300 links, 10 scenarios');
  for (const s of input.scenarios || []) if ((s.steps?.length || 0) > 50 || (s.mocks?.length || 0) > 20) throw new Error('Scenario limit: 50 steps and 20 mocks');
  const config = { ...input, baseURL, maxPages: input.maxPages ?? 10, maxLinks: input.maxLinks ?? 100, timeoutMs: 10000, outDir: 'run-report', baselineDir: 'baselines' };
  normalizeConfig(config);
  return config;
}
