import { makeRequest } from './request-link.mjs';
const $ = id => document.getElementById(id);
let settings;
const text = (tag, content, className) => { const el = document.createElement(tag); el.textContent = content; if (className) el.className = className; return el; };
const localReport = value => /^reports\/\d+-\d+\/report\.(html|json)$/.test(value);
async function refresh() {
  $('refresh').disabled = true;
  try {
    const response = await fetch(`history.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('הדוחות עדיין לא זמינים. בדקו את מצב ההרצה ב־GitHub.');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('לא ניתן לקרוא את רשימת הדוחות.');
    $('history').replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.append(text('bdi', row.demonstration ? 'אתרון תקלות מכוונות' : row.baseURL), text('span', new Date(row.createdAt).toLocaleString('he-IL'), 'date'));
      const status = document.createElement('td');
      status.append(text('span', row.demonstration ? 'דוגמה עם תקלות' : row.exitCode === 0 ? 'לא נחצה הסף' : row.exitCode === 1 ? 'נמצאו ממצאים' : 'בדיקה חלקית', `badge ${row.demonstration || row.exitCode === 1 ? 'warning' : row.exitCode === 0 ? 'good' : 'bad'}`));
      const coverage = text('td', `${row.pages} עמודים · ${row.findings} ממצאים`);
      const links = document.createElement('td'); links.className = 'links';
      for (const [url, label] of [[row.report,'פתיחת הדוח'],[row.json,'JSON']]) if (localReport(url)) { const a=text('a',label); a.href=url; links.append(a); }
      tr.append(name,status,coverage,links); $('history').append(tr);
    }
    $('history-status').textContent = rows.length ? '' : 'ההרצה הראשונה עדיין לא פורסמה.';
  } catch (error) { $('history-status').textContent = error.message; }
  finally { $('refresh').disabled = false; }
}
$('scan-form').addEventListener('submit', event => {
  event.preventDefault(); $('form-status').textContent = '';
  try {
    const request = makeRequest({ repository: settings?.repository, baseURL: $('base-url').value.trim(), pages: $('pages').value, sitemap: $('sitemap').value, maxPages: Number($('max-pages').value), failOn: $('fail-on').value, crawl: $('crawl').checked, advanced: $('advanced').value });
    location.assign(request.url);
  } catch (error) { $('form-status').textContent = error instanceof SyntaxError ? 'ה־JSON אינו תקין. בדקו פסיקים ומרכאות בהגדרות הנוספות.' : error.message; }
});
$('refresh').addEventListener('click', refresh);
try {
  const response = await fetch('config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('לא ניתן לטעון את הגדרות הפרויקט.');
  settings = await response.json();
  if (!/^[\w.-]+\/[\w.-]+$/.test(settings.repository)) throw new Error('הגדרות המאגר אינן תקינות.');
  $('repository').href = `https://github.com/${settings.repository}`;
  $('actions').href = `https://github.com/${settings.repository}/actions/workflows/qa-pages.yml`;
  $('scenario-docs').href = `https://github.com/${settings.repository}/blob/main/examples/fixture.config.json`;
  $('owner-note').textContent = `יש להתחבר ל־GitHub כ־${settings.repository.split('/')[0]}. לאחר לחיצה על Create issue, חזרו לכאן ורעננו את הדוחות. אין צורך בטוקן או בשרת מקומי.`;
  $('submit').disabled = false;
} catch (error) { $('owner-note').textContent = error.message; }
await refresh();
