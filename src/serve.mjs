// Local read-only static server. No build hooks, APIs, proxying, or write routes.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml', '.png': 'image/png', '.gif': 'image/gif', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain', '.pdf': 'application/pdf' };
export async function serveDirectory(directory, port = 0) {
  const root = await fs.realpath(directory);
  const server = http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      const rel = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
      let file = path.resolve(root, '.' + rel);
      if (!file.startsWith(root + path.sep) || rel.split(/[\\/]/).some(p => p.startsWith('.')) || !types[path.extname(file).toLowerCase()]) throw new Error('not allowed');
      file = await fs.realpath(file); if (!file.startsWith(root + path.sep)) throw new Error('symlink outside root');
      const body = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()], 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { baseURL: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { const server = await serveDirectory(process.argv[2], Number(process.argv[3] || 4174)); console.log(server.baseURL); }
