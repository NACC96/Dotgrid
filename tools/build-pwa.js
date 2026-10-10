'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const RUNTIME_FILES = Object.freeze([
  'scripts/lib/history.js', 'scripts/document.js', 'scripts/viewport.js',
  'scripts/generator.js', 'scripts/tool.js', 'scripts/input.js',
  'scripts/renderer.js', 'scripts/manager.js', 'scripts/lib/source.js',
  'scripts/projects.js', 'scripts/pwa.js', 'scripts/interface.js', 'scripts/client.js'
])
const STYLE_FILES = Object.freeze(['links/main.css', 'links/theme.css'])
const PUBLIC_FILES = Object.freeze(['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', '404.html', '_headers'])
const BOOTSTRAP = `
const DOTGRID_RELEASE = document.querySelector('meta[name="dotgrid-release"]').content;
const missingCapabilities = [];
if (!document.createElement('canvas').getContext('2d')) missingCapabilities.push('Canvas 2D');
if (typeof Path2D === 'undefined') missingCapabilities.push('vector paths');
if (typeof PointerEvent === 'undefined') missingCapabilities.push('Pointer Events');
if (missingCapabilities.length) {
  document.body.textContent = 'This browser cannot run Dotgrid: missing ' + missingCapabilities.join(', ') + '. Open it in Safari 17 or later on iPadOS. Local projects have not been changed.';
} else {
  window.client = new Client();
  client.install(document.body);
  client.start();
}
`
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function shell (jsAsset, cssAsset, release) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#15191e">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Dotgrid">
  <meta name="dotgrid-release" content="${release}">
  <title>Dotgrid iPad</title>
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="icon" type="image/svg+xml" href="./icons/icon.svg">
  <link rel="apple-touch-icon" href="./icons/icon-192.png">
  <link rel="stylesheet" href="./${cssAsset}">
  <script src="./${jsAsset}" defer></script>
</head>
<body><noscript>Dotgrid needs JavaScript to edit and save your local drawings.</noscript></body>
</html>
`
}

function build (options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || path.join(__dirname, '..'))
  const outDir = path.resolve(options.outDir || path.join(sourceRoot, 'dist'))
  // Replacing the dedicated output directory removes stale resources. Never
  // allow a caller to accidentally select the source checkout or its parent.
  if (sourceRoot === outDir || sourceRoot.startsWith(outDir + path.sep)) throw new Error('The distribution must have its own output directory.')
  const read = name => fs.readFileSync(path.join(sourceRoot, name))
  const runtime = RUNTIME_FILES.map(name => `\n/* ${name} */\n${read(name).toString('utf8')}\n`).join('') + BOOTSTRAP
  const css = STYLE_FILES.map(name => `/* ${name} */\n${read(name).toString('utf8')}\n`).join('\n')
  const jsAsset = `app.${digest(runtime).slice(0, 16)}.js`
  const cssAsset = `app.${digest(css).slice(0, 16)}.css`
  const output = new Map(PUBLIC_FILES.map(name => [name, read('public/' + name)]))
  output.set(jsAsset, Buffer.from(runtime))
  output.set(cssAsset, Buffer.from(css))
  output.set('LICENSE.txt', read('LICENSE'))
  output.set('UPSTREAM-ASSETS-LICENSE.txt', read('LICENSE.by-nc-sa-4.0.md'))
  output.set('NOTICE.txt', Buffer.from('Dotgrid iPad\n\nForked from Hundredrabbits Dotgrid. Source code is distributed under the MIT license in LICENSE.txt. The upstream separate license for images, text, and non-code assets is retained in UPSTREAM-ASSETS-LICENSE.txt.\n\nThe application icons in this fork were newly drawn for Dotgrid iPad; they are distributed under the source MIT license. No upstream artwork or example project is shipped in this application shell. Drawings created or imported by a user remain in that user\'s browser storage and exported files.\n'))
  const workerTemplate = read('public/service-worker.js').toString('utf8')
  // All release inputs are content-derived: no clocks, absolute paths or Git
  // state. A compatible recovery build must change an input to get a new ID.
  const release = digest([...output.entries()].map(([name, bytes]) => name + ':' + digest(bytes)).join('\n') + workerTemplate + shell(jsAsset, cssAsset, '')).slice(0, 20)
  output.set('index.html', Buffer.from(shell(jsAsset, cssAsset, release)))
  const types = { '.html': 'text/html', '.js': 'javascript', '.css': 'text/css', '.webmanifest': 'manifest', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' }
  const precache = [...output.entries()].filter(([name]) => name !== '_headers').map(([url, bytes]) => ({ url, fetchUrl: url === 'index.html' ? './' : url === '404.html' ? '404' : url, type: types[path.extname(url)], sha256: digest(bytes) }))
  output.set('service-worker.js', Buffer.from(workerTemplate.replace('__RELEASE__', JSON.stringify(release)).replace('__PRECACHE__', JSON.stringify(precache, null, 2))))
  fs.rmSync(outDir, { recursive: true, force: true })
  for (const [name, bytes] of output) {
    const file = path.join(outDir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
  }
  if (options.writeLegacy !== false) {
    // Root entry points use the same release resources. Only dist is deployed.
    const legacy = shell('dist/' + jsAsset, 'dist/' + cssAsset, release).replace('./manifest.webmanifest', './dist/manifest.webmanifest').replaceAll('./icons/', './dist/icons/')
    fs.writeFileSync(path.join(sourceRoot, 'index.html'), legacy)
    fs.writeFileSync(path.join(sourceRoot, 'debug.html'), legacy)
  }
  return { release, jsAsset, cssAsset, precache, outDir }
}

function cliOptions (args) {
  const at = args.indexOf('--out')
  if (at !== -1 && !args[at + 1]) throw new Error('--out requires a directory.')
  return { outDir: at === -1 ? undefined : args[at + 1], writeLegacy: !args.includes('--no-legacy') }
}

if (require.main === module) console.log(`Built Dotgrid iPad release ${build(cliOptions(process.argv.slice(2))).release}`)
module.exports = { build, cliOptions, RUNTIME_FILES, STYLE_FILES }
