'use strict'

function managerLibrary () { return typeof module !== 'undefined' ? require('./projects.js').ProjectLibrary : ProjectLibrary }
function managerGenerator () { if (typeof module === 'undefined') return Generator; const exported = require('./generator.js'); return exported.Generator || exported }
function managerEscape (value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]) }
const managerError = typeof module !== 'undefined' ? require('./projects.js').projectError : projectError

function Manager (client) {
  const snapshot = () => managerLibrary().validate(client.document && typeof client.document.snapshot === 'function'
    ? (client.document.data || client.document.snapshot())
    : { settings: client.tool.settings, layers: client.tool.layers, styles: client.tool.styles })
  const title = () => client.projectName || 'Drawing'
  const filename = format => `${String(title()).replace(/[\u0000-\u001f/\\:]/g, '-').trim() || 'Drawing'}.${format}`
  const paths = data => data.layers.map((layer, index) => new (managerGenerator())(layer, data.styles[index], data.settings.size).toString())

  const serializeSVG = data => {
    const { width, height } = data.settings.size
    const geometry = paths(data)
    const layers = [2, 1, 0].map(index => {
      const style = data.styles[index]
      return `<path data-layer="${index}" d="${managerEscape(geometry[index])}" stroke="${managerEscape(style.color)}" fill="${managerEscape(style.fill)}" stroke-width="${managerEscape(style.thickness)}" stroke-linecap="${managerEscape(style.strokeLinecap)}" stroke-linejoin="${managerEscape(style.strokeLinejoin)}"/>`
    }).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden"><title>${managerEscape(title())}</title><metadata>${managerEscape(JSON.stringify(data))}</metadata>${layers}</svg>`
  }
  this.svg = input => serializeSVG(managerLibrary().validate(input))
  this.toString = () => serializeSVG(snapshot())
  this.install = () => {}
  this.update = () => {
    const xml = this.toString()
    if (typeof DOMParser !== 'undefined') this.el = new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement
    return xml
  }
  this.el = { get outerHTML () { return client.manager ? client.manager.toString() : '' } }

  this.prepare = async (format, { scale = 2, maxPixels = 16777216 } = {}) => {
    const data = snapshot()
    const preparedName = filename(format)
    if (format === 'grid') return new File([JSON.stringify(data)], preparedName, { type: 'application/json' })
    if (format === 'svg') return new File([serializeSVG(data)], preparedName, { type: 'image/svg+xml' })
    if (format !== 'png') throw managerError('UNSUPPORTED_FORMAT', 'Choose .grid, SVG, or PNG for this export.')
    const { width, height } = data.settings.size
    const pixelWidth = Math.ceil(width * scale)
    const pixelHeight = Math.ceil(height * scale)
    // This ceiling is provisional until measured on supported iPads. Check it
    // before any canvas allocation; UI can offer a smaller explicit scale.
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isSafeInteger(maxPixels) || maxPixels <= 0 || !Number.isSafeInteger(pixelWidth) || !Number.isSafeInteger(pixelHeight) || pixelWidth * pixelHeight > maxPixels) {
      throw managerError('RASTER_LIMIT', 'This PNG exceeds the raster allocation limit. Choose a lower export resolution or export SVG/.grid instead.')
    }
    if (typeof document === 'undefined' || typeof Path2D === 'undefined') throw managerError('RASTER_UNAVAILABLE', 'PNG export requires Canvas2D and Path2D. SVG and .grid backups are still available.')
    let canvas
    try {
      canvas = document.createElement('canvas')
      canvas.width = pixelWidth
      canvas.height = pixelHeight
      const context = canvas.getContext('2d')
      if (!context) throw managerError('RASTER_UNAVAILABLE', 'The browser could not allocate the PNG canvas. Try a smaller resolution or export SVG/.grid.')
      context.scale(scale, scale)
      context.beginPath()
      context.rect(0, 0, width, height)
      context.clip()
      const geometry = paths(data)
      for (const index of [2, 1, 0]) {
        const style = data.styles[index]
        const path = new Path2D(geometry[index])
        context.lineWidth = style.thickness
        context.lineCap = style.strokeLinecap
        context.lineJoin = style.strokeLinejoin
        if (style.fill !== 'none') { context.fillStyle = style.fill; context.fill(path) }
        if (style.color !== 'none' && style.thickness > 0) { context.strokeStyle = style.color; context.stroke(path) }
      }
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(managerError('RASTER_ENCODING_FAILED', 'The browser could not encode this PNG. Try a smaller resolution or export SVG/.grid.')), 'image/png')
      })
      return new File([blob], preparedName, { type: 'image/png' })
    } catch (error) {
      if (error.code) throw error
      throw managerError('RASTER_FAILED', 'PNG preparation failed. Try a smaller resolution or export SVG/.grid; the drawing has been preserved.', error)
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0 }
    }
  }

  // Existing callers can transition to prepared files without stale SVG data.
  this.toSVG = async callback => { const file = await this.prepare('svg'); if (callback) callback(file, file.name); return file }
  this.toGRID = async callback => { const file = await this.prepare('grid'); if (callback) callback(file, file.name); return file }
  this.toPNG = async (size, callback) => { const file = await this.prepare('png'); if (callback) callback(file, file.name); return file }
}

if (typeof module !== 'undefined') module.exports = { Manager, managerEscape }
