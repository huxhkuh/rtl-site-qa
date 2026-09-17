export function makeRequest({ repository, baseURL, pages, sitemap, maxPages, failOn, crawl, advanced }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('הגדרות המאגר לא נטענו. רעננו את הדף.');
  const url = new URL(baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || url.hash) throw new Error('יש להזין כתובת HTTP או HTTPS ציבורית, ללא פרטי התחברות או עוגן.');
  const extra = advanced.trim() ? JSON.parse(advanced) : {};
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('ההגדרות הנוספות צריכות להיות אובייקט JSON.');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 30) throw new Error('מגבלת העמודים צריכה להיות בין 1 ל־30.');
  const config = { ...extra, baseURL: url.href, pages: pages.split(/\r?\n/).map(x=>x.trim()).filter(Boolean), maxPages, failOn, crawl };
  if (sitemap.trim()) config.sitemap = sitemap.trim();
  if (!config.pages.length && !config.sitemap) throw new Error('הוסיפו לפחות עמוד אחד או מפת אתר.');
  const body = 'בקשת סריקה של בעל המאגר. הדוח וצילומי המסך יפורסמו באתר הציבורי.\n\n```json\n' + JSON.stringify(config, null, 2) + '\n```\n';
  if (body.length > 6000) throw new Error('ההגדרות ארוכות מדי לקישור. הפעילו את הבדיקה דרך Run workflow עם config_json ב־GitHub.');
  const target = new URL(`https://github.com/${repository}/issues/new`);
  target.searchParams.set('title', `[RTL QA] ${url.hostname}`);
  target.searchParams.set('body', body);
  if (target.href.length > 7500) throw new Error('הבקשה ארוכה מדי לקישור. הפעילו דרך Run workflow עם config_json ב־GitHub.');
  return { url: target.href, config };
}
