import http from 'node:http';
import { pathToFileURL } from 'node:url';

const shell = body => `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>מעבדת RTL</title><style>body{font:18px Arial;max-width:1000px;margin:0 auto;padding:24px;background:#f5f5ee;color:#193d38}button,input{font:inherit;padding:8px}a{color:#07614f}section{padding:18px 0;border-bottom:1px solid #ccc}img{width:100px;height:70px}*:focus-visible{outline:3px solid #a94412;outline-offset:4px}[hidden]{display:none!important}</style><body>${body}</body></html>`;
export async function startFixture({ port = 0, externalURL = 'http://example.invalid' } = {}) {
  const hits = [], mutations = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture'); hits.push({ method: req.method, path: url.pathname });
    if (!['GET', 'HEAD'].includes(req.method) || url.pathname === '/danger') mutations.push({ method: req.method, path: url.pathname });
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/offline') { req.socket.destroy(); return; }
    if (url.pathname === '/server-error') { res.writeHead(500); res.end('intentional failure'); return; }
    if (url.pathname === '/submit' || url.pathname === '/danger') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
    if (url.pathname === '/redirect-external') { res.writeHead(302, { Location: externalURL + '/sentinel' }); res.end(); return; }
    if (url.pathname === '/redirect-chain') { res.writeHead(302, { Location: '/redirect-external' }); res.end(); return; }
    if (url.pathname === '/loop') { res.writeHead(302, { Location: '/loop2' }); res.end(); return; }
    if (url.pathname === '/loop2') { res.writeHead(302, { Location: '/loop' }); res.end(); return; }
    if (url.pathname === '/sitemap.xml') { res.setHeader('Content-Type', 'application/xml'); res.end(`<sitemapindex><sitemap><loc>/pages.xml</loc></sitemap><sitemap><loc>/sitemap.xml</loc></sitemap><sitemap><loc>${externalURL}/foreign.xml</loc></sitemap></sitemapindex>`); return; }
    if (url.pathname === '/pages.xml') { res.setHeader('Content-Type', 'application/xml'); res.end('<urlset><url><loc>/</loc></url><url><loc>/clean</loc></url><url><loc>/?utm_source=test</loc></url></urlset>'); return; }
    if (url.pathname === '/evil.xml') { res.setHeader('Content-Type', 'application/xml'); res.end('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset>&x;</urlset>'); return; }
    if (url.pathname === '/pixel.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><rect width="100" height="70" fill="#276e5b"/></svg>'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/clean') {
      res.end(shell(`<h1>עמוד תקין להשוואה</h1><p>תוכן עברי שנכנס למסך גם במובייל.</p><h2>פרטים</h2><img src="/pixel.svg" alt="מלבן ירוק"><label for="good-name">שם</label><input id="good-name"><p><a href="/clean#details">מעבר לפרטים</a></p><div id="details">פרטים נוספים</div><div style="width:120px;overflow:auto"><div style="width:350px">אזור גלילה מכוון</div></div>`)); return;
    }
    if (url.pathname === '/') {
      res.end(shell(`<h1>מעבדת תקלות מכוונות</h1><p>כל רכיב בעמוד נועד לאמת בדיקה אחרת.</p>
      <section><button id="menu-toggle" aria-controls="menu" aria-expanded="false">תפריט שבור</button><nav id="menu" hidden><a href="/clean">עמוד תקין</a></nav><button id="safe-menu-toggle" aria-controls="safe-menu" aria-expanded="false">תפריט תקין</button><nav id="safe-menu" hidden><a href="/clean">עמוד תקין</a></nav></section>
      <section><div id="overflow" style="width:calc(100vw + 90px);background:#efd7ca;padding:10px">רכיב רחב מדי שחורג שמאלה ב־RTL</div><p id="clipped" style="width:150px;white-space:nowrap;overflow:hidden">זהו משפט ארוך בעברית שנחתך באמצע בלי שהמשתמש יכול לקרוא את כולו.</p></section>
      <section><h3>דילוג כותרת מכוון</h3><img id="broken-image" src="/missing-image.png"><a id="broken-link" href="/missing">קישור שבור</a> · <a href="#missing-anchor">עוגן חסר</a> · <a href="/clean?b=2&a=1">עמוד נוסף</a> · <a href="/clean?a=1&b=2">אותו עמוד</a> · <a href="/logout">כתובת מוחרגת</a></section>
      <section><details id="faq"><summary>איך הבדיקה עובדת?</summary><p id="answer">הדפדפן בודק פעולות וראיות.</p></details></section>
      <section><form id="contact"><input id="nameless" placeholder="שם ללא תווית"><label for="email">אימייל</label><input id="email" type="email" required><button type="submit">בדיקת טופס</button><p id="status" role="status"></p></form><div id="unreachable" role="button" onclick="this.textContent='בוצע'">כפתור שאינו נגיש למקלדת</div><button id="danger" onclick="fetch('/danger')">פעולת GET מדומה</button><button id="post-danger" onclick="fetch('/submit',{method:'POST'})">פעולת POST מדומה</button></section>
      <script>document.querySelector('#menu-toggle').onclick=()=>document.querySelector('#menu-toggle').setAttribute('aria-expanded','true');document.querySelector('#safe-menu-toggle').onclick=()=>{const m=document.querySelector('#safe-menu');m.hidden=!m.hidden;document.querySelector('#safe-menu-toggle').setAttribute('aria-expanded',String(!m.hidden))};document.querySelector('#contact').onsubmit=async e=>{e.preventDefault();const r=await fetch('/submit',{method:'POST',body:'test'});document.querySelector('#status').textContent=r.ok?'הדמיה הצליחה':'שגיאה'};fetch('/offline').catch(()=>{});fetch('/server-error');setTimeout(()=>{throw new Error('intentional-fixture-js-error')},20);</script>`)); return;
    }
    res.writeHead(404); res.end(shell('<h1>העמוד לא נמצא</h1>'));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, hits, mutations, baseURL: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixture({ port: Number(process.argv[2] || 4173) }); console.log(fixture.baseURL);
}
