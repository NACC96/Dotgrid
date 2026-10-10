'use strict'
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const root = path.resolve(value('--root', fs.existsSync('dist/index.html') ? 'dist' : '.'))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.grid': 'application/json' }
http.createServer((req, res) => {
  let pathname
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { res.writeHead(400).end(); return }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  if (!file.startsWith(root + path.sep) || /(^|\/)\./.test(pathname) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-cache' })
    if (req.method === 'HEAD') res.end()
    else fs.createReadStream(file).pipe(res)
  })
}).listen(Number(value('--port', process.env.PORT || 4173)), value('--host', '127.0.0.1'), () => console.log('Dotgrid server ready'))
