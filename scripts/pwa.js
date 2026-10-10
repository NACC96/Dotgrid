'use strict'

function PWAController (client) {
  this.status = 'Offline use has not been prepared'
  this.offlineReady = false
  this.updateAvailable = false
  this.registration = null
  this._started = false
  this._updating = false
  this._reload = false
  this._reloaded = false
  this._freezeRequest = null
  this.release = document.querySelector('meta[name="dotgrid-release"]')?.content || ''

  this._notify = () => { if (typeof client.update === 'function') client.update() }
  this._status = text => { this.status = text; this._notify() }
  this._pending = () => !!(client.input && client.input.active) || !!(client.tool && client.tool.vertices && client.tool.vertices.length)
  this._releaseFreeze = id => {
    if (id && this._freezeRequest !== id) return
    this._freezeRequest = null
    this._reload = false
    client.editFrozen = false
    this._notify()
  }
  this._message = (worker, message, timeout = 10000) => new Promise((resolve, reject) => {
    if (!worker) { reject(new Error('An active application worker is required. Reconnect and reopen Dotgrid.')); return }
    const channel = new MessageChannel()
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('The application worker did not respond. Reconnect and retry.')) }, timeout)
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data) }
    try { worker.postMessage(message, [channel.port2]) } catch (error) { clearTimeout(timer); channel.port1.close(); reject(error) }
  })
  this.verify = async () => {
    try {
      const result = await this._message(navigator.serviceWorker.controller, { type: 'DOTGRID_VERIFY_CACHE' })
      this.offlineReady = result.ok === true && result.complete === true
      this.updateAvailable = !!this.registration?.waiting
      this._status(this.offlineReady ? (this.updateAvailable ? 'Offline ready · Update available' : 'Offline ready') : 'Offline cache incomplete. Reconnect and repair the app cache.')
      return this.offlineReady
    } catch (error) {
      this.offlineReady = false
      this._status('Offline use is not ready. ' + error.message)
      return false
    }
  }
  this._waiting = () => {
    this.updateAvailable = !!this.registration?.waiting
    if (this.updateAvailable) this._status(this.offlineReady ? 'Offline ready · Update available' : 'Update available. Prepare offline use after updating.')
    this._notify()
  }
  this._prepare = async event => {
    const id = event.data.requestId
    let safe = false
    // Other editors cannot silently clear construction or commit a dirty
    // draft merely because somebody else requested an application update.
    if ((!client.editFrozen || this._freezeRequest === id) && (!this._freezeRequest || this._freezeRequest === id) && !this._pending() && client.saveState === 'Saved') {
      this._freezeRequest = id
      client.editFrozen = true
      this._reload = true
      this._notify()
      const revision = client.document.revision
      try { safe = await client.checkpoint() === true && client.saveState === 'Saved' && client.document.revision === revision && !this._pending() } catch (error) { safe = false }
    }
    if (!safe) this._releaseFreeze(id)
    try { event.source?.postMessage({ type: 'DOTGRID_UPDATE_ACK', requestId: id, safe, release: this.release }) } catch (error) { this._releaseFreeze(id) }
  }
  this.start = async () => {
    if (this._started) return this.registration
    this._started = true
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('caches' in window)) {
      this._status('Offline app caching is unavailable. Open Dotgrid over HTTPS in a supported browser.')
      return null
    }
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'DOTGRID_UPDATE_PREPARE') this._prepare(event)
      if (event.data?.type === 'DOTGRID_UPDATE_RELEASE') this._releaseFreeze(event.data.requestId)
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this._reload && !this._reloaded) { this._reloaded = true; window.location.reload(); return }
      this.verify()
    })
    window.addEventListener('online', () => this.checkForUpdate())
    try {
      this._status('Preparing offline use…')
      const script = document.querySelector('script[src*="app."]')
      const base = script ? new URL('.', script.src) : new URL('./', window.location.href)
      if (!window.location.href.startsWith(base.href)) { this._status('Open the generated app at ' + base.pathname + ' to prepare offline use.'); return null }
      this.registration = await navigator.serviceWorker.register(new URL('service-worker.js', base), { scope: base.href, updateViaCache: 'none' })
      this.registration.addEventListener('updatefound', () => {
        const worker = this.registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') { this._waiting(); if (!navigator.serviceWorker.controller) this._status('Offline cache prepared. Reopen Dotgrid to finish setup.') }
          if (worker.state === 'redundant' && !this.offlineReady) this._status('Offline setup failed. Reconnect and repair the app cache.')
        })
      })
      this._waiting()
      if (navigator.serviceWorker.controller) await this.verify()
      return this.registration
    } catch (error) { this._status('Offline setup failed. ' + error.message); return null }
  }
  this.checkForUpdate = async () => {
    if (!this.registration) return false
    if (navigator.onLine === false) { this._status(this.offlineReady ? 'Offline ready · Update check postponed until connected' : 'Reconnect to prepare offline use'); return false }
    try { await this.registration.update(); this._waiting(); await this.verify(); return true } catch (error) { this._status(this.offlineReady ? 'Offline ready · Update check postponed until connected' : 'Reconnect to prepare offline use'); return false }
  }
  this.saveAndUpdate = async () => {
    const waiting = this.registration?.waiting
    if (!waiting || this._updating || client.editFrozen) return false
    this._updating = true
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()
    try {
      if (client.input && typeof client.input.cancelAll === 'function') client.input.cancelAll()
      if (await client.guardPending() !== true) { this._status('Update postponed. Finish or discard pending construction when ready.'); return false }
      this._freezeRequest = id
      client.editFrozen = true
      this._notify()
      const revision = client.document.revision
      if (await client.checkpoint() !== true || client.saveState !== 'Saved' || this._pending() || client.document.revision !== revision) throw new Error('The latest drawing could not be saved. Keep editing or export a .grid backup, then retry.')
      this._reload = true
      this._status('Drawing saved. Checking other open editors…')
      const result = await this._message(waiting, { type: 'DOTGRID_UPDATE_ACTIVATE', requestId: id }, 12000)
      if (!result.ok) throw new Error(result.reason || 'Another editor must finish or close before updating. Retry later.')
      this._status('Drawing saved. Opening the new release…')
      return true
    } catch (error) {
      try { waiting.postMessage({ type: 'DOTGRID_UPDATE_ABORT', requestId: id }) } catch (abortError) { /* A replaced or failed worker cannot receive an abort. */ }
      this._releaseFreeze(id)
      this._status('Update postponed. ' + error.message)
      return false
    } finally {
      this._updating = false
      if (!this._reload) this._releaseFreeze(id)
    }
  }
  this.repair = async () => {
    try {
      this._status('Repairing the app cache. Local projects are kept…')
      const result = await this._message(navigator.serviceWorker?.controller, { type: 'DOTGRID_REPAIR_CACHE' }, 30000)
      if (!result.ok) throw new Error(result.reason)
      return await this.verify()
    } catch (error) { this.offlineReady = false; this._status('Cache repair needs a connection. ' + error.message); return false }
  }
}
