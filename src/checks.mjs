// This function is serialized into the browser. Keep all DOM helpers inside it.
export function inspectDOM({ tolerance = 2, maxElements = 12000 } = {}) {
  const findings = [];
  const selector = el => {
    if (el === document.documentElement) return 'html';
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    while (el && el !== document.documentElement && parts.length < 7) {
      const tag = el.tagName.toLowerCase();
      const siblings = [...(el.parentElement?.children || [])].filter(x => x.tagName === el.tagName);
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(el) + 1})`); el = el.parentElement;
    }
    return parts.join(' > ');
  };
  const visible = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && s.display !== 'none' && s.visibility === 'visible' && r.width > 0 && r.height > 0 && !el.closest('[hidden],[inert],[aria-hidden="true"]'); };
  const add = (check, severity, el, evidence, certainty = 'observed') => findings.push({ check, severity, certainty, selector: el ? selector(el) : null, evidence });
  const elements = [...document.body.querySelectorAll('*')];
  if (elements.length > maxElements) add('dom-limit', 'info', null, { total: elements.length, inspected: maxElements });
  const width = document.documentElement.clientWidth;
  const scrollWidth = (document.scrollingElement || document.documentElement).scrollWidth;
  const rootOverflow = getComputedStyle(document.documentElement).overflowX;
  if (scrollWidth > width + tolerance) add(['hidden', 'clip'].includes(rootOverflow) ? 'clipped-document' : 'horizontal-scroll', ['hidden', 'clip'].includes(rootOverflow) ? 'medium' : 'high', document.documentElement, { viewport: width, scrollWidth, extraPixels: scrollWidth - width, rootOverflow }, ['hidden', 'clip'].includes(rootOverflow) ? 'suspected' : 'observed');
  for (const el of elements.slice(0, maxElements)) {
    if (!visible(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    // Deliberately ignore content clipped by a carousel, scroll area, or closed panel.
    let clippedByParent = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(p).overflowX)) { clippedByParent = true; break; }
    }
    if (!clippedByParent && (r.left < -tolerance || r.right > width + tolerance)) add('outside-viewport', 'medium', el, { left: Math.round(r.left), right: Math.round(r.right), width, direction: s.direction });
    const directText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (directText && ((['hidden', 'clip'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + tolerance) || (['hidden', 'clip'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + tolerance))) {
      add('text-clipping', 'medium', el, { client: [el.clientWidth, el.clientHeight], scroll: [el.scrollWidth, el.scrollHeight], textOverflow: s.textOverflow, lineClamp: s.webkitLineClamp, note: 'ייתכן קיצור טקסט מכוון או line-clamp; נדרשת בדיקה אנושית.' }, 'suspected');
    }
    if (el.tagName === 'IMG') {
      if (!el.complete) add('image-unsettled', 'medium', el, { src: el.currentSrc || el.src, complete: false, note: 'ייתכן שהתמונה עדיין נטענת או טרם הופעלה טעינה עצלה.' }, 'suspected');
      else if (el.naturalWidth === 0) add('image-broken', 'high', el, { src: el.currentSrc || el.src, complete: true, naturalWidth: el.naturalWidth });
      if (!el.hasAttribute('alt')) add('image-alt-missing', 'medium', el, { src: el.currentSrc || el.src });
    }
    if (el.matches('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]),select,textarea')) {
      const refs = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      const named = el.getAttribute('aria-label')?.trim() || refs.some(id => document.getElementById(id)?.textContent.trim()) || [...(el.labels || [])].some(l => l.textContent.trim()) || el.title?.trim();
      if (!named) add('form-label-missing', 'medium', el, { tag: el.tagName, type: el.type, placeholderIsNotLabel: !!el.getAttribute('placeholder') });
    }
    if (el.matches('button,[role="button"]')) {
      const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).some(id => document.getElementById(id)?.textContent.trim());
      if (!el.textContent.trim() && !el.getAttribute('aria-label')?.trim() && !labelled && !el.title && !el.querySelector('img[alt]:not([alt=""])')) add('button-name-missing', 'medium', el, {});
    }
    if (el.matches('[role="button"],[onclick]') && !el.matches('button,input,select,textarea,a[href],summary') && el.tabIndex < 0) add('keyboard-unreachable', 'medium', el, { role: el.getAttribute('role'), tabIndex: el.tabIndex });
    if (el.tabIndex > 0) add('positive-tabindex', 'low', el, { tabIndex: el.tabIndex }, 'suspected');
  }
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
  const h1 = headings.filter(x => x.tagName === 'H1');
  if (h1.length !== 1) add('heading-h1', 'low', h1[0], { count: h1.length }, 'suspected');
  let last = 0;
  for (const h of headings) { const level = Number(h.tagName[1]); if (last && level > last + 1) add('heading-skip', 'low', h, { previousLevel: last, level }, 'suspected'); last = level; }
  if (!document.documentElement.lang) add('language-missing', 'medium', document.documentElement, {});
  if (document.documentElement.lang.startsWith('he') && getComputedStyle(document.body).direction !== 'rtl') add('rtl-direction', 'medium', document.body, { direction: getComputedStyle(document.body).direction }, 'suspected');
  const anchors = [...document.querySelectorAll('a[href]')].map(el => ({ href: el.href, selector: selector(el) }));
  return { findings, anchors, title: document.title, direction: getComputedStyle(document.body).direction, elements: elements.length };
}

export async function inspectKeyboard(page, steps, onFinding) {
  const findings = [], visited = [];
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    await page.evaluate(() => new Promise(resolve => { const timer = setTimeout(resolve, 100); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); })); }));
    const measure = () => page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      const selector = el.id ? `#${CSS.escape(el.id)}` : (() => {const parts=[];for(let n=el;n&&n!==document.documentElement;n=n.parentElement){const siblings=[...n.parentElement.children].filter(x=>x.tagName===n.tagName);parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(n)+1})`)}return parts.join(' > ');})();
      return { selector, tag: el.tagName, htmlType: el.getAttribute('type'), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        hidden: !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || r.width === 0 || r.height === 0,
        outside: r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight,
        possibleNoIndicator: (s.outlineStyle === 'none' || parseFloat(s.outlineWidth) === 0) && s.boxShadow === 'none' };
    });
    let item = await measure();
    if (!item) continue;
    // Let skip-link and focus transitions settle before declaring the focus hidden.
    if (item.hidden || item.outside) { await page.waitForTimeout(450); item = await measure(); if (!item) continue; }
    visited.push(item);
    let finding;
    if (item.hidden || item.outside) finding = { check: 'focus-invisible', severity: 'medium', certainty: 'observed', selector: item.selector, evidence: { tabNumber: i + 1, ...item } };
    else if (item.possibleNoIndicator) finding = { check: 'focus-indicator', severity: 'low', certainty: 'suspected', selector: item.selector, evidence: { tabNumber: i + 1, note: 'לא נמצאו outline או box-shadow. ייתכן חיווי בעזרת צבע, גבול או pseudo-element.' } };
    if (finding) { if (onFinding) await onFinding(finding, i); findings.push(finding); }
  }
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  return { findings, visited };
}
