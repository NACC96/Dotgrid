const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { build, RUNTIME_FILES } = require('../../tools/build-pwa.js')

const sourceRoot = path.resolve(__dirname, '../..')
function fixture (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotgrid-build-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  fs.mkdirSync(source)
  for (const name of [...RUNTIME_FILES, 'links/main.css', 'links/theme.css', 'LICENSE', 'LICENSE.by-nc-sa-4.0.md']) {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, name), path.join(source, name))
  }
  fs.cpSync(path.join(sourceRoot, 'public'), path.join(source, 'public'), { recursive: true })
  return { sourceRoot: source, outDir: path.join(root, 'dist'), writeLegacy: false }
}
function files (dir, prefix = '') {
  return fs.readdirSync(dir).sort().flatMap(name => fs.statSync(path.join(dir, name)).isDirectory() ? files(path.join(dir, name), prefix + name + '/') : [prefix + name])
}
function digest (data) { return crypto.createHash('sha256').update(data).digest('hex') }

test('distribution is deterministic, explicit, external-script CSP compatible and complete', t => {
  const options = fixture(t)
  fs.mkdirSync(path.join(options.sourceRoot, 'scripts/unused'))
  fs.writeFileSync(path.join(options.sourceRoot, 'scripts/unused/secret.js'), 'NEVER_SHIP_THIS')
  fs.writeFileSync(path.join(options.sourceRoot, 'public/private.grid'), '{"drawing":"private"}')
  const first = build(options)
  const names = files(options.outDir)
  const before = new Map(names.map(name => [name, digest(fs.readFileSync(path.join(options.outDir, name)))]))
  fs.writeFileSync(path.join(options.outDir, 'old-artifact.js'), 'stale')
  const second = build(options)
  assert.equal(second.release, first.release)
  assert.deepEqual(files(options.outDir), names)
  for (const [name, hash] of before) assert.equal(digest(fs.readFileSync(path.join(options.outDir, name))), hash)
  assert.deepEqual(names, ['404.html', 'LICENSE.txt', 'NOTICE.txt', 'UPSTREAM-ASSETS-LICENSE.txt', '_headers', first.cssAsset, first.jsAsset, 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg', 'manifest.webmanifest', 'index.html', 'service-worker.js'].sort())
  const html = fs.readFileSync(path.join(options.outDir, 'index.html'), 'utf8')
  assert.match(html, /rel="manifest"/)
  assert.match(html, /apple-touch-icon/)
  assert.doesNotMatch(html, /<script[^>]*>[^<]+<\/script>/)
  const runtime = fs.readFileSync(path.join(options.outDir, first.jsAsset), 'utf8')
  assert.doesNotThrow(() => new vm.Script(runtime))
  assert.match(runtime, /window\.client = new Client\(\)/)
  assert.doesNotMatch(runtime, /NEVER_SHIP_THIS|function Cursor|function Picker|function Theme|function Acels/)
  const headers = fs.readFileSync(path.join(options.outDir, '_headers'), 'utf8')
  assert.match(headers, /script-src 'self'/)
  assert.doesNotMatch(headers, /unsafe-inline|unsafe-eval/)
  const worker = fs.readFileSync(path.join(options.outDir, 'service-worker.js'), 'utf8')
  assert.match(worker, new RegExp(first.release))
  assert.doesNotMatch(worker, /__PRECACHE__|__RELEASE__/)
  for (const entry of first.precache) {
    assert.equal(digest(fs.readFileSync(path.join(options.outDir, entry.url))), entry.sha256)
    assert.ok(entry.type)
  }
})

test('manifest has stable app identity and owned PNG icons', t => {
  const options = fixture(t)
  build(options)
  const manifest = JSON.parse(fs.readFileSync(path.join(options.outDir, 'manifest.webmanifest')))
  assert.equal(manifest.name, 'Dotgrid iPad')
  assert.equal(manifest.id, './')
  assert.equal(manifest.scope, './')
  assert.equal(manifest.start_url, './')
  assert.equal(manifest.display, 'standalone')
  for (const size of [192, 512]) {
    const icon = fs.readFileSync(path.join(options.outDir, `icons/icon-${size}.png`))
    assert.equal(icon.subarray(1, 4).toString(), 'PNG')
    assert.equal(icon.readUInt32BE(16), size)
    assert.equal(icon.readUInt32BE(20), size)
  }
})

test('changing an app source creates a new consistent release and never copies arbitrary files', t => {
  const options = fixture(t)
  const before = build(options)
  fs.appendFileSync(path.join(options.sourceRoot, 'scripts/client.js'), '\n// release two\n')
  const after = build(options)
  assert.notEqual(after.release, before.release)
  assert.notEqual(after.jsAsset, before.jsAsset)
  assert.ok(!files(options.outDir).includes(before.jsAsset))
})
