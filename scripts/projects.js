'use strict'

/* Limits are provisional until measured on the supported iPads. Reject whole
 * documents at these ceilings; never silently truncate imported artwork. */
const PROJECT_LIMITS = Object.freeze({ maxJsonBytes: 10 * 1024 * 1024, maxVertices: 50000, maxSegments: 50000, maxDimension: 10000, maxThickness: 10000, maxNameLength: 200 })
const PROJECT_TYPES = new Set(['line', 'arc_c', 'arc_r', 'arc_c_full', 'arc_r_full', 'bezier', 'close'])
const PROJECT_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen none').split(' '))

function projectError (code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) error.cause = cause
  return error
}

function projectStorageError (error) {
  if (error && error.code && typeof error.code === 'string') return error
  if (error && error.name === 'QuotaExceededError') return projectError('QUOTA_EXCEEDED', 'Local storage is full. Keep this draft open, export a .grid backup, and free space before retrying.', error)
  return projectError('STORAGE_UNAVAILABLE', 'Local saving is unavailable. Keep this draft open and export a .grid backup; check browser storage permissions and retry.', error)
}

function projectObject (value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function projectPaint (value) {
  if (typeof value !== 'string' || value.length > 200) return false
  const paint = value.trim().toLowerCase()
  if (PROJECT_COLORS.has(paint) || /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(paint)) return true
  // CSS numeric colors are local values. URL paints, variables, markup and
  // context-dependent colors cannot safely round-trip into standalone files.
  const match = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(([^()]+)\)$/.exec(paint)
  if (!match) return false
  const numeric = token => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/.test(token) && Number.isFinite(parseFloat(token))
  const hue = token => numeric(token) || (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|grad|rad|turn)$/.test(token) && Number.isFinite(parseFloat(token)))
  const body = match[2].trim()
  let values
  let alpha
  if (body.includes(',')) {
    if (!/^(?:rgba?|hsla?)$/.test(match[1]) || body.includes('/')) return false
    values = body.split(',').map(token => token.trim())
    if (values.length === 4) alpha = values.pop()
  } else {
    const parts = body.split('/')
    if (parts.length > 2) return false
    values = parts[0].trim().split(/\s+/)
    alpha = parts.length === 2 ? parts[1].trim() : undefined
  }
  if (values.length !== 3 || (alpha !== undefined && !numeric(alpha))) return false
  if (/^(?:hsla?|hwb)$/.test(match[1])) return hue(values[0]) && values.slice(1).every(token => numeric(token) && token.endsWith('%'))
  if (match[1] === 'lch' || match[1] === 'oklch') return numeric(values[0]) && numeric(values[1]) && hue(values[2])
  return values.every(numeric)
}

function ProjectLibrary (options = {}) {
  if (typeof options === 'string') options = { name: options }
  this.name = options.name || options.databaseName || 'dotgrid-projects'
  this.indexedDB = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB
  this.persistence = { supported: false, persisted: false, requested: false }
  this._db = null
  this._opening = null
  this._closed = false
  this._writes = Promise.resolve()

  this.open = async () => {
    this._closed = false
    if (this._db) return this
    if (this._opening) return this._opening
    if (!this.indexedDB || typeof this.indexedDB.open !== 'function') throw projectStorageError()
    this._opening = new Promise((resolve, reject) => {
      let settled = false
      let request
      const fail = error => { if (!settled) { settled = true; reject(error) } }
      try { request = this.indexedDB.open(this.name, 1) } catch (error) { fail(projectStorageError(error)); return }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('projects')) request.result.createObjectStore('projects', { keyPath: 'id' })
      }
      request.onblocked = () => fail(projectError('STORAGE_BLOCKED', 'Another Dotgrid tab is holding the project library open. Finish or close that tab, then retry opening this library.'))
      request.onerror = () => fail(request.error && request.error.name === 'VersionError'
        ? projectError('UNSUPPORTED_SCHEMA', 'This project library was created by a newer Dotgrid release. Open it with that release; the library has been preserved.', request.error)
        : projectStorageError(request.error))
      request.onsuccess = () => {
        if (settled || this._closed) { request.result.close(); fail(projectError('STORAGE_CLOSED', 'The project library was closed. Reopen it before saving.')); return }
        settled = true
        this._db = request.result
        this._db.onversionchange = () => {
          this._db.close()
          this._db = null
          this._closed = true
        }
        resolve(this)
      }
    })
    try {
      await this._opening
      const storage = options.storage === undefined ? globalThis.navigator && globalThis.navigator.storage : options.storage
      if (storage) {
        this.persistence.supported = typeof storage.persisted === 'function'
        try {
          this.persistence.persisted = typeof storage.persisted === 'function' ? await storage.persisted() : false
          if (!this.persistence.persisted && typeof storage.persist === 'function') {
            this.persistence.requested = true
            this.persistence.persisted = await storage.persist()
          }
        } catch (error) { this.persistence.error = error.message }
      }
      return this
    } finally { this._opening = null }
  }

  this._transaction = async (mode, run) => {
    if (this._closed) throw projectError('STORAGE_CLOSED', 'The project library was closed. Reopen it before saving.')
    await this.open()
    return new Promise((resolve, reject) => {
      let transaction
      let result
      let failure
      try { transaction = this._db.transaction('projects', mode) } catch (error) { reject(projectStorageError(error)); return }
      const fail = error => {
        failure = error
        try { transaction.abort() } catch (abortError) { reject(failure) }
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(failure || projectStorageError(transaction.error))
      transaction.onerror = () => {} // The abort event owns the failed-save result.
      try { run(transaction.objectStore('projects'), value => { result = value }, fail) } catch (error) { fail(projectStorageError(error)) }
    })
  }
  this._write = action => {
    const next = this._writes.then(action)
    this._writes = next.catch(() => {})
    return next
  }
  this._record = record => {
    if (!record) throw projectError('NOT_FOUND', 'This local project no longer exists. Keep the draft and save it as a new project.')
    if (record.schemaVersion !== 1) throw projectError('UNSUPPORTED_SCHEMA', 'This project uses an unsupported schema. Open it with a compatible Dotgrid release; the stored record has been preserved.')
    if (!Number.isSafeInteger(record.revision) || record.revision < 1) throw projectError('CORRUPT_PROJECT', 'The stored project revision is unreadable. Export any open draft before continuing.')
    return record
  }
  this._expected = (record, revision) => {
    this._record(record)
    if (!Number.isSafeInteger(revision) || revision < 1) throw projectError('REVISION_REQUIRED', 'A saved project revision is required to change this project. Load its current saved version first.')
    if (record.revision !== revision) throw projectError('CONFLICT', 'This project changed in another editor. Keep this draft, save it as a copy, or export it before loading the saved version.')
  }
  this._recover = record => {
    this._record(record)
    try { return { ...record, payload: ProjectLibrary.validate(record.payload), recovered: false } } catch (error) {
      if (error.code === 'UNSUPPORTED_SCHEMA') throw error
      const previous = record.previous
      if (previous && Number.isSafeInteger(previous.revision) && previous.revision >= 1 && previous.revision < record.revision) {
        try {
          return { ...record, payload: ProjectLibrary.validate(previous.payload), recovered: true, recoveredRevision: previous.revision, recoveryReason: error.message }
        } catch (previousError) { /* Both stored snapshots must remain untouched. */ }
      }
      throw projectError('CORRUPT_PROJECT', 'The newest project and its recovery snapshot are unreadable. The stored record has been preserved; export any open draft before continuing.', error)
    }
  }

  this.list = () => this._transaction('readonly', (store, done) => {
    const projects = []
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { done(projects.sort((a, b) => b.updatedAt - a.updatedAt)); return }
      const { id, name, schemaVersion, revision, createdAt, updatedAt } = cursor.value
      projects.push({ id, name, schemaVersion, revision, createdAt, updatedAt })
      cursor.continue()
    }
  })
  this.load = async id => {
    const record = await this._transaction('readonly', (store, done) => { const request = store.get(id); request.onsuccess = () => done(request.result) })
    return this._recover(record)
  }
  this.create = async (name, payload) => {
    const prepared = ProjectLibrary.validate(payload)
    const projectName = ProjectLibrary.validateName(name)
    return this._write(() => this._transaction('readwrite', (store, done) => {
      const now = Date.now()
      const id = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${now.toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
      const record = { id, name: projectName, schemaVersion: 1, revision: 1, createdAt: now, updatedAt: now, payload: prepared, previous: null }
      store.add(record)
      done({ ...record, recovered: false })
    }))
  }
  this.save = async (id, name, payload, expectedRevision) => {
    const prepared = ProjectLibrary.validate(payload)
    const projectName = ProjectLibrary.validateName(name)
    return this._write(() => this._transaction('readwrite', (store, done, fail) => {
      const request = store.get(id)
      request.onsuccess = () => {
        try {
          const existing = request.result
          this._expected(existing, expectedRevision)
          const good = this._recover(existing)
          const record = { ...existing, name: projectName, revision: existing.revision + 1, updatedAt: Date.now(), payload: prepared, previous: { revision: good.recovered ? good.recoveredRevision : good.revision, payload: good.payload } }
          store.put(record)
          done({ ...record, recovered: false })
        } catch (error) { fail(error) }
      }
    }))
  }
  this.rename = async (id, name, expectedRevision) => {
    const projectName = ProjectLibrary.validateName(name)
    return this._write(() => this._transaction('readwrite', (store, done, fail) => {
      const request = store.get(id)
      request.onsuccess = () => {
        try {
          this._expected(request.result, expectedRevision)
          const record = { ...request.result, name: projectName, revision: request.result.revision + 1, updatedAt: Date.now() }
          store.put(record)
          done(this._recover(record))
        } catch (error) { fail(error) }
      }
    }))
  }
  this.duplicate = async (id, name) => {
    const original = await this.load(id)
    return this.create(name || `${original.name} copy`, original.payload)
  }
  this.delete = (id, expectedRevision) => this._write(() => this._transaction('readwrite', (store, done, fail) => {
    const request = store.get(id)
    request.onsuccess = () => {
      try { this._expected(request.result, expectedRevision); store.delete(id); done(true) } catch (error) { fail(error) }
    }
  }))
  this.close = () => { this._closed = true; if (this._db) this._db.close(); this._db = null }
}

ProjectLibrary.LIMITS = PROJECT_LIMITS
ProjectLibrary.validateName = name => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > PROJECT_LIMITS.maxNameLength) throw projectError('INVALID_NAME', `Project names must contain 1–${PROJECT_LIMITS.maxNameLength} characters.`)
  return name.trim()
}
ProjectLibrary.validate = input => {
  let text
  try { text = typeof input === 'string' ? input : JSON.stringify(input) } catch (error) { throw projectError('INVALID_DOCUMENT', 'The drawing must be a JSON document.', error) }
  if (typeof text !== 'string') throw projectError('INVALID_DOCUMENT', 'The drawing must be a JSON document.')
  if (text.length > PROJECT_LIMITS.maxJsonBytes || new TextEncoder().encode(text).byteLength > PROJECT_LIMITS.maxJsonBytes) throw projectError('RESOURCE_LIMIT', 'This .grid document exceeds the provisional 10 MiB import limit. No artwork was loaded or truncated.')
  let data
  try { data = JSON.parse(text) } catch (error) { throw projectError('INVALID_JSON', 'The .grid file contains invalid JSON. The current drawing has been preserved.', error) }
  const invalid = message => { throw projectError('INVALID_DOCUMENT', message) }
  if (!projectObject(data)) invalid('The drawing must contain settings, three layers, and three styles.')
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1) throw projectError('UNSUPPORTED_SCHEMA', 'This drawing uses an unsupported schema version. Open it with a compatible Dotgrid release.')
  if (!projectObject(data.settings)) invalid('The drawing is missing its document settings.')
  if (data.settings.size === undefined && data.settings.width !== undefined && data.settings.height !== undefined) data.settings.size = { width: data.settings.width, height: data.settings.height }
  if (!projectObject(data.settings.size)) invalid('The drawing is missing its document dimensions.')
  for (const axis of ['width', 'height']) {
    const value = data.settings.size[axis]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid(`Document ${axis} must be a positive finite number.`)
    if (value > PROJECT_LIMITS.maxDimension) throw projectError('RESOURCE_LIMIT', `Document ${axis} exceeds the provisional ${PROJECT_LIMITS.maxDimension} unit limit. No artwork was loaded or truncated.`)
    if (Object.hasOwn(data.settings, axis)) data.settings[axis] = value
  }
  if (!Array.isArray(data.layers) || data.layers.length !== 3 || !data.layers.every(Array.isArray)) invalid('The drawing must contain exactly three layer arrays.')
  if (!Array.isArray(data.styles) || data.styles.length !== 3) invalid('The drawing must contain exactly three layer styles.')
  let vertices = 0
  let segments = 0
  for (let layer = 0; layer < 3; layer++) {
    for (const segment of data.layers[layer]) {
      if (!projectObject(segment) || !PROJECT_TYPES.has(segment.type)) invalid(`Layer ${layer + 1} contains an unsupported geometry type.`)
      if (segment.type === 'close' && segment.vertices === undefined) segment.vertices = []
      if (!Array.isArray(segment.vertices)) invalid(`Layer ${layer + 1} contains invalid vertices.`)
      const minimum = segment.type === 'close' ? 0 : segment.type === 'bezier' ? 3 : 2
      if (segment.vertices.length < minimum || (segment.type === 'close' && segment.vertices.length)) invalid(`A ${segment.type} segment has an invalid vertex count.`)
      vertices += segment.vertices.length
      segments++
      if (vertices > PROJECT_LIMITS.maxVertices || segments > PROJECT_LIMITS.maxSegments) throw projectError('RESOURCE_LIMIT', 'This drawing exceeds the provisional geometry limit. No artwork was loaded or truncated.')
      for (const vertex of segment.vertices) {
        if (!projectObject(vertex) || typeof vertex.x !== 'number' || typeof vertex.y !== 'number' || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) invalid('Every vertex must contain finite numeric x and y coordinates.')
      }
    }
    const style = data.styles[layer]
    if (!projectObject(style)) invalid(`Layer ${layer + 1} is missing its style.`)
    if (typeof style.thickness !== 'number' || !Number.isFinite(style.thickness) || style.thickness < 0 || style.thickness > PROJECT_LIMITS.maxThickness) invalid('Stroke thickness must be a finite number within the supported range.')
    if (!['butt', 'round', 'square'].includes(style.strokeLinecap) || !['miter', 'round', 'bevel'].includes(style.strokeLinejoin)) invalid('The drawing contains an unsupported stroke cap or join.')
    if (!projectPaint(style.color) || !projectPaint(style.fill)) invalid('The drawing contains an unsupported stroke or fill color. Use a local CSS color or none.')
    style.color = style.color.trim().toLowerCase() === 'none' ? 'none' : style.color.trim()
    style.fill = style.fill.trim().toLowerCase() === 'none' ? 'none' : style.fill.trim()
    if (style.mirror_style === undefined) style.mirror_style = 0
    if (![0, 1, 2, 3].includes(style.mirror_style)) invalid('The drawing contains an unsupported mirror style.')
  }
  // Normalizing legacy dimensions must not produce a stored/exported payload
  // that this same validator would reject on its next round-trip.
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > PROJECT_LIMITS.maxJsonBytes) throw projectError('RESOURCE_LIMIT', 'The normalized drawing exceeds the provisional 10 MiB limit. No artwork was loaded or truncated.')
  return data
}

if (typeof module !== 'undefined') module.exports = { ProjectLibrary, projectError }
