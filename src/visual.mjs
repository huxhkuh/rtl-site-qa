import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export const hash = text => crypto.createHash('sha256').update(text).digest('hex');
export const shotKey = (url, v, state = 'page') => hash(`${url}|${v.width}x${v.height}|${state}`).slice(0, 20);
export async function scrollToEvidence(locator) {
  await locator.evaluate(el => {
    const ancestors = [];
    for (let node = el; node; node = node.parentElement) ancestors.push([node, node.scrollLeft]);
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    // RTL overflow can make scrollIntoView shift a clipped body horizontally,
    // producing a misleading screenshot. Preserve every ancestor's horizontal offset.
    for (const [node, left] of ancestors) node.scrollLeft = left;
  });
}
export async function screenshot(page, file, c) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', mask: c.maskSelectors.map(s => page.locator(s)), timeout: c.timeoutMs });
}
export async function compareScreenshot(file, key, fingerprint, c) {
  if (!c.visual.enabled) return { status: 'disabled' };
  const baseline = path.join(c.baselineDir, `${key}.png`), metaFile = path.join(c.baselineDir, `${key}.json`);
  let meta, bytes;
  try { meta = JSON.parse(await fs.readFile(metaFile, 'utf8')); bytes = await fs.readFile(baseline); }
  catch (e) { if (e.code === 'ENOENT') return { status: 'no-approved-baseline' }; throw e; }
  if (!meta.approvedAt || !meta.approvedBy || meta.sha256 !== hash(bytes)) return { status: 'invalid-baseline', reason: 'missing approval or hash mismatch' };
  if (meta.fingerprint !== fingerprint) return { status: 'incompatible-baseline', reason: 'browser/platform/viewport/masks differ' };
  const actual = PNG.sync.read(await fs.readFile(file)), expected = PNG.sync.read(bytes);
  const expectedFile = file.replace(/\.png$/, '-baseline.png'); await fs.copyFile(baseline, expectedFile);
  if (actual.width !== expected.width || actual.height !== expected.height) return { status: 'changed', ratio: 1, reason: 'image-dimensions', baseline: path.relative(c.outDir, expectedFile).replaceAll('\\', '/') };
  const diff = new PNG({ width: actual.width, height: actual.height });
  const pixels = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, { threshold: c.visual.pixelThreshold });
  const ratio = pixels / (actual.width * actual.height);
  const diffFile = file.replace(/\.png$/, '-diff.png');
  await fs.writeFile(diffFile, PNG.sync.write(diff));
  return { status: ratio > c.visual.maxDiffRatio ? 'changed' : 'matched', ratio, pixels, maxDiffRatio: c.visual.maxDiffRatio, baseline: path.relative(c.outDir, expectedFile).replaceAll('\\', '/'), diff: path.relative(c.outDir, diffFile).replaceAll('\\', '/') };
}
export async function approveBaseline(reportFile, baselineDir, approvedBy, keys) {
  if (!approvedBy?.trim() || !keys?.length) throw new Error('Explicit --by and --keys are required after visual review');
  const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
  if (report.incomplete || report.fatal) throw new Error('Cannot approve an incomplete run');
  const all = report.pages.flatMap(p => p.screenshots || []), root = path.dirname(path.resolve(reportFile));
  await fs.mkdir(baselineDir, { recursive: true });
  for (const key of keys) {
    if (!/^[a-f0-9]{20}$/.test(key)) throw new Error('Invalid screenshot key');
    const item = all.find(x => x.key === key); if (!item) throw new Error(`Screenshot not found: ${key}`);
    const file = path.resolve(root, item.file);
    if (!file.startsWith(root + path.sep)) throw new Error('Screenshot outside report directory');
    const data = await fs.readFile(file);
    await fs.writeFile(path.join(baselineDir, `${key}.png`), data);
    await fs.writeFile(path.join(baselineDir, `${key}.json`), JSON.stringify({ approvedAt: new Date().toISOString(), approvedBy, sha256: hash(data), fingerprint: item.fingerprint, source: report.runId }, null, 2));
  }
  return keys.length;
}
