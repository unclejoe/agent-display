// 本地同源代理：静态托管 index.html + 反代 /api 到 Octop，免 CORS。
// 用法： node serve.mjs [port]   （默认 8081）
// 访问： http://127.0.0.1:8081/index.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8081);
const OCTOP = { host: '127.0.0.1', port: 8088, path: '/api' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function pipe(src, dst) {
  src.on('data', (c) => dst.write(c));
  src.on('end', () => dst.end());
  src.on('error', () => dst.destroy());
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // ---- 反代 Octop API：同源代理，浏览器不需要 CORS ----
  if (url.pathname.startsWith(OCTOP.path) || url.pathname === OCTOP.path) {
    const up = new URL('http://' + OCTOP.host + ':' + OCTOP.port + url.pathname + url.search);
    const upstream = await import('node:http').then((m) => m.request({
      protocol: 'http:', hostname: OCTOP.host, port: OCTOP.port, path: up.pathname + up.search,
      method: req.method, headers: req.headers,
    }, (ur) => {
      res.writeHead(ur.statusCode || 502, ur.headers);
      pipe(ur, res);
    }));
    upstream.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('proxy error: ' + e.message); });
    req.pipe(upstream);
    return;
  }

  // ---- 静态文件 ----
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + p);
  }
});

server.listen(PORT, () => {
  console.log(`[serve] http://127.0.0.1:${PORT}/index.html  (Octop /api → 127.0.0.1:8088)`);
});
