'use strict'

function sourceLibrary () { return typeof module !== 'undefined' ? require('../projects.js').ProjectLibrary : ProjectLibrary }
const sourceError = typeof module !== 'undefined' ? require('../projects.js').projectError : projectError

function Source (client) {
  this.cache = {}
  this.install = () => {}
  this.start = () => this.new()
  this.new = () => { this.cache = {} }

  this.read = async (file, callback, store = false) => {
    if (!file) return null
    if (file.size > sourceLibrary().LIMITS.maxJsonBytes) throw sourceError('RESOURCE_LIMIT', 'This .grid file exceeds the provisional 10 MiB import limit. The current drawing has been preserved.')
    let text
    try {
      if (typeof file.text === 'function') text = await file.text()
      else text = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('The selected file could not be read.'))
        reader.onabort = () => resolve(null)
        reader.readAsText(file, 'UTF-8')
      })
    } catch (error) { throw sourceError('FILE_READ_FAILED', 'The selected file could not be read. Choose it again; the current drawing has been preserved.', error) }
    if (text === null) return null
    const payload = sourceLibrary().validate(text)
    if (callback) await callback(file, JSON.stringify(payload))
    if (store) this.cache[file.name] = payload
    return payload
  }

  // Invoke from a user action. The callback receives the fully validated copy;
  // neither picking nor cancelling changes the active document.
  this.choose = callback => new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.grid,application/json'
    input.setAttribute('aria-label', 'Import a Dotgrid drawing')
    input.style.position = 'fixed'
    input.style.left = '-10000px'
    let settled = false
    const finish = (value, error) => {
      if (settled) return
      settled = true
      input.remove()
      if (error) reject(error)
      else resolve(value)
    }
    input.addEventListener('cancel', () => finish(null), { once: true })
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0]
      if (!file) { finish(null); return }
      try {
        const payload = await this.read(file)
        if (payload && callback) await callback(payload, file)
        finish(payload)
      } catch (error) { finish(null, error) }
    }, { once: true })
    document.body.appendChild(input)
    try { input.click() } catch (error) { finish(null, sourceError('FILE_PICKER_FAILED', 'The file picker could not open. Try Import again.', error)) }
  })

  this.canShare = file => {
    const navigator = globalThis.navigator
    if (!file || !navigator || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
    try { return navigator.canShare({ files: [file] }) } catch (error) { return false }
  }
  this.share = async file => {
    if (!this.canShare(file)) throw sourceError('SHARE_UNAVAILABLE', 'This browser cannot share this file. Use Download to keep a copy in Files.')
    try {
      // No asynchronous preparation precedes this call: Share gets the fresh
      // activation from the user's tap on the already prepared file.
      await globalThis.navigator.share({ files: [file] })
      return true
    } catch (error) {
      if (error.name === 'AbortError') return false
      throw sourceError('SHARE_FAILED', 'Sharing failed. The prepared file is still available; try Share again or use Download.', error)
    }
  }
  this.download = file => {
    if (!(file instanceof Blob)) throw sourceError('INVALID_FILE', 'Prepare an export file before downloading it.')
    if (!globalThis.URL || typeof URL.createObjectURL !== 'function') throw sourceError('DOWNLOAD_UNAVAILABLE', 'This browser cannot prepare a download. Try Share or another supported browser.')
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name || 'Drawing.grid'
    document.body.appendChild(link)
    try { link.click() } catch (error) {
      URL.revokeObjectURL(url)
      throw sourceError('DOWNLOAD_FAILED', 'The download could not start. The prepared file is still available; try again.', error)
    } finally { link.remove() }
    // Safari may consume the URL after click returns. Retain it through that
    // handoff, then release it without retaining the export indefinitely.
    const timer = setTimeout(() => URL.revokeObjectURL(url), 60000)
    if (timer && typeof timer.unref === 'function') timer.unref()
    return url
  }

  // Compatibility for the existing file and clipboard entry points.
  this.open = (ext, callback) => this.choose((payload, file) => callback && callback(file, JSON.stringify(payload)))
  this.load = (ext, callback) => this.open(ext, callback)
  this.store = (file, payload) => { this.cache[file.name] = payload }
  this.write = (name, ext, content, type = 'text/plain') => {
    const mime = ext === 'grid' ? 'application/json' : type
    let parts = [content]
    if (typeof content === 'string' && content.startsWith('data:')) {
      const comma = content.indexOf(',')
      const header = content.slice(0, comma)
      const body = content.slice(comma + 1)
      parts = [header.includes(';base64') ? Uint8Array.from(atob(body), character => character.charCodeAt(0)) : decodeURIComponent(body)]
    }
    return this.download(new File(parts, `${name || 'Drawing'}.${ext}`, { type: mime }))
  }
  this.saveAs = (name, ext, content, type) => this.write(name, ext, content, type)
  this.save = (name, content, type = 'application/json') => this.write(name, 'grid', content, type)
}

if (typeof module !== 'undefined') module.exports = { Source }
