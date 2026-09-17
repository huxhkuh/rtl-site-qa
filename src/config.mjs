import path from 'node:path';

export const levels = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
export const defaults = {
  pages: ['/'], sitemap: [], crawl: true, maxPages: 20, maxLinks: 200, maxSitemaps: 10,
  exclude: ['/logout', '/signout', '/checkout', '/cart', '/delete', '/remove', '/purchase', '/unsubscribe', '/api/'],
  viewports: [{ name: 'mobile', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }],
  timeoutMs: 10000, settleMs: 300, maxScrollSteps: 12, keyboardSteps: 12,
  failOn: 'high', scenarios: [], allowedResourceOrigins: [],
  ignoreQueryParams: ['utm_*', 'fbclid', 'gclid'],
  ignoreChecks: [], maskSelectors: ['input', 'textarea', '[data-qa-private]'],
  visual: { enabled: true, maxDiffRatio: 0.01, pixelThreshold: 0.15 },
};
export function normalizeConfig(input, directory = process.cwd()) {
  const c = { ...defaults, ...input, visual: { ...defaults.visual, ...input.visual } };
  if (!input?.baseURL) throw new Error('baseURL is required');
  const base = new URL(c.baseURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('baseURL must be HTTP(S) without credentials');
  c.baseURL = base.href; c.origin = base.origin;
  for (const key of ['pages', 'exclude', 'allowedResourceOrigins', 'ignoreQueryParams', 'ignoreChecks', 'maskSelectors', 'scenarios']) {
    if (!Array.isArray(c[key])) throw new Error(`${key} must be an array`);
  }
  c.sitemap = typeof c.sitemap === 'string' ? [c.sitemap] : c.sitemap;
  if (!Array.isArray(c.sitemap)) throw new Error('sitemap must be a string or array');
  for (const key of ['pages', 'sitemap', 'exclude', 'allowedResourceOrigins', 'ignoreQueryParams', 'ignoreChecks', 'maskSelectors']) {
    if (c[key].some(x => typeof x !== 'string')) throw new Error(`${key} must contain strings`);
  }
  for (const [key, max] of Object.entries({ maxPages: 500, maxLinks: 5000, maxSitemaps: 100, timeoutMs: 60000, settleMs: 10000, maxScrollSteps: 100, keyboardSteps: 100 })) {
    if (!Number.isInteger(c[key]) || c[key] < (['settleMs', 'keyboardSteps', 'maxScrollSteps'].includes(key) ? 0 : 1) || c[key] > max) throw new Error(`Invalid ${key} (max ${max})`);
  }
  if (c.failOn !== 'none' && !(c.failOn in levels)) throw new Error('failOn must be none/info/low/medium/high/critical');
  if (!Array.isArray(c.viewports) || !c.viewports.length || c.viewports.length > 10) throw new Error('1–10 viewports required');
  for (const v of c.viewports) if (!Number.isInteger(v.width) || v.width < 240 || v.width > 3840 || !Number.isInteger(v.height) || v.height < 240 || v.height > 2160) throw new Error('Invalid viewport');
  if (new Set(c.viewports.map(v => `${v.width}x${v.height}`)).size !== c.viewports.length) throw new Error('Duplicate viewport');
  c.allowedResourceOrigins = c.allowedResourceOrigins.map(x => { const u = new URL(x); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid resource origin'); return u.origin; });
  for (const k of ['maxDiffRatio', 'pixelThreshold']) if (typeof c.visual[k] !== 'number' || c.visual[k] < 0 || c.visual[k] > 1) throw new Error(`Invalid visual.${k}`);
  c.outDir = path.resolve(directory, c.outDir || `runs/${new Date().toISOString().replaceAll(':', '-')}`);
  c.baselineDir = path.resolve(directory, c.baselineDir || 'baselines');
  const ids = new Set();
  for (const s of c.scenarios) {
    if (typeof s.name !== 'string' || !s.name.trim() || ['page', 'error'].includes(s.name) || ids.has(s.name) || !Array.isArray(s.steps) || !s.steps.length || typeof s.page !== 'string') throw new Error('Scenarios require unique name (other than page/error), page, and steps');
    ids.add(s.name);
    if (!canonical(s.page, c.baseURL, c)) throw new Error(`Scenario out of scope: ${s.name}`);
    for (const step of s.steps) {
      if (!['click', 'fill', 'press', 'expectVisible', 'expectHidden', 'expectText', 'expectAttribute', 'expectFocused'].includes(step.action) || !step.selector) throw new Error(`Invalid scenario step: ${s.name}`);
      if (['fill', 'press', 'expectText', 'expectAttribute'].includes(step.action) && typeof step.value !== 'string') throw new Error('Step requires string value');
      if (step.action === 'expectAttribute' && typeof step.attribute !== 'string') throw new Error('expectAttribute requires attribute');
    }
    for (const m of s.mocks || []) {
      const u = new URL(m.url, c.baseURL);
      if (!['http:', 'https:'].includes(u.protocol) || !m.method || !Number.isInteger(m.status) || m.status < 200 || m.status > 599 || (m.status >= 300 && m.status < 400)) throw new Error('Mock requires exact URL, method, non-redirect status');
    }
  }
  return c;
}
export function glob(pattern, text) {
  return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*') + '$', 'i').test(text);
}
export function excluded(url, c) {
  const u = new URL(url); let decoded = u.pathname + u.search;
  try { decoded = decodeURIComponent(decoded); } catch { /* compare raw malformed URLs */ }
  return c.exclude.some(x => x.includes('*') ? glob(x, decoded) || glob(x, u.href) : decoded.toLowerCase().includes(x.toLowerCase()));
}
export function canonical(value, from, c) {
  try {
    const u = new URL(value, from);
    if (!['http:', 'https:'].includes(u.protocol) || u.origin !== c.origin || u.username || u.password || excluded(u.href, c)) return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (c.ignoreQueryParams.some(p => glob(p, k))) u.searchParams.delete(k);
    u.searchParams.sort();
    return u.href;
  } catch { return null; }
}
export function exitCode(report, failOn) {
  if (report.fatal || report.incomplete) return 2;
  return failOn !== 'none' && report.findings.some(f => f.certainty !== 'suspected' && levels[f.severity] >= levels[failOn]) ? 1 : 0;
}
