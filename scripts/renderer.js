'use strict'
const RenderGenerator =
  typeof module !== 'undefined' ? require('./generator.js') : Generator

function LayerPathCache(makePath = (path) => new Path2D(path)) {
  this.entries = []
  this.builds = 0
  let previous = null
  this.update = (data) => {
    if (data === previous) return this.entries
    previous = data
    data.layers.forEach((layer, index) => {
      const key = JSON.stringify([
        layer,
        data.styles[index].mirror_style,
        data.settings.size
      ])
      if (this.entries[index] && this.entries[index].key === key) return
      const text = new RenderGenerator(
        layer,
        data.styles[index],
        data.settings.size
      ).toString()
      this.entries[index] = { key, path: makePath(text), text }
      this.builds++
    })
    return this.entries
  }
}

function Renderer(client) {
  this.el = document.createElement('canvas')
  this.el.id = 'guide'
  this.el.setAttribute(
    'aria-label',
    'Drawing canvas. Apple Pencil draws; two fingers pan and zoom.'
  )
  this.el.tabIndex = 0
  this.context = this.el.getContext('2d')
  this.showExtras = true
  this.cache = new LayerPathCache()
  this.metrics = {
    frames: 0,
    pathBuilds: 0,
    samples: [],
    frameGaps: [],
    longTasks: 0,
    backingPixels: 0
  }
  this.pointer = null
  let frame = 0
  let lastFrame = 0
  let observer
  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
  ) {
    observer = new PerformanceObserver((list) => {
      this.metrics.longTasks += list.getEntries().length
    })
    observer.observe({ type: 'longtask', buffered: false })
  }
  this.update = () => {
    if (!frame)
      frame = requestAnimationFrame((time) => {
        frame = 0
        this.draw(time)
      })
  }
  this.resize = () => {
    const rect = this.el.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      Math.sqrt(16777216 / (width * height))
    )
    const backingWidth = Math.round(width * ratio)
    const backingHeight = Math.round(height * ratio)
    if (this.el.width === backingWidth && this.el.height === backingHeight)
      return
    this.el.width = backingWidth
    this.el.height = backingHeight
    this.ratio = ratio
    if (!client.viewport.width)
      client.viewport.fit(client.tool.settings.size, width, height)
    else client.viewport.resize(width, height)
    this.metrics.backingPixels = backingWidth * backingHeight
    this.update()
  }
  this.toggle = () => {
    this.showExtras = !this.showExtras
    client.update()
  }
  this.draw = (time) => {
    const start = performance.now()
    const ctx = this.context
    const viewport = client.viewport
    const data = client.tool.renderDocument()
    const size = data.settings.size
    const paths = this.cache.update(data)
    const ratio = this.ratio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.el.width, this.el.height)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = '#ebece8'
    ctx.fillRect(0, 0, viewport.width, viewport.height)
    ctx.translate(viewport.x, viewport.y)
    ctx.scale(viewport.scale, viewport.scale)
    ctx.fillStyle = '#fafbf8'
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.strokeStyle = '#c2c8c1'
    ctx.lineWidth = 1 / viewport.scale
    ctx.strokeRect(0, 0, size.width, size.height)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, size.width, size.height)
    ctx.clip()
    if (this.showExtras) this.drawGrid(size)
    for (const index of [2, 1, 0]) {
      const style = data.styles[index]
      ctx.lineWidth = style.thickness
      ctx.strokeStyle = style.color
      ctx.lineCap = style.strokeLinecap
      ctx.lineJoin = style.strokeLinejoin
      if (style.fill !== 'none') {
        ctx.fillStyle = style.fill
        ctx.fill(paths[index].path)
      }
      if (style.color !== 'none' && style.thickness > 0)
        ctx.stroke(paths[index].path)
    }
    if (this.showExtras && data.styles[client.tool.index].mirror_style) {
      const mirror = data.styles[client.tool.index].mirror_style
      ctx.beginPath()
      ctx.setLineDash([5 / viewport.scale, 5 / viewport.scale])
      ctx.strokeStyle = '#a8b6af'
      ctx.lineWidth = 1 / viewport.scale
      if (mirror === 1 || mirror === 3) {
        ctx.moveTo(size.width / 2, 0)
        ctx.lineTo(size.width / 2, size.height)
      }
      if (mirror === 2 || mirror === 3) {
        ctx.moveTo(0, size.height / 2)
        ctx.lineTo(size.width, size.height / 2)
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
    const tool = client.tool
    if (tool.canCast() && tool.operation !== 'close') {
      const path = new Path2D(
        new RenderGenerator(
          [{ type: tool.operation, vertices: tool.vertices }],
          {},
          size
        ).toString()
      )
      ctx.strokeStyle = '#677b70'
      ctx.lineWidth = 1.5 / viewport.scale
      ctx.setLineDash([6 / viewport.scale, 6 / viewport.scale])
      ctx.stroke(path)
      ctx.setLineDash([])
    }
    if (this.showExtras || tool.mode !== 'draw')
      data.layers[tool.index].forEach((segment) =>
        segment.vertices.forEach((point) => this.dot(point, 2.5, '#8c9c91'))
      )
    tool.vertices.forEach((point, index) => {
      this.dot(point, 5, '#238673')
      ctx.fillStyle = '#18282c'
      ctx.font = `${12 / viewport.scale}px system-ui`
      ctx.fillText(
        String(index + 1),
        point.x + 8 / viewport.scale,
        point.y - 8 / viewport.scale
      )
    })
    if (tool.target) {
      if (tool.mode.includes('segment') || tool.mode === 'duplicate') {
        const selected = data.layers[tool.index][tool.target.segmentId]
        if (selected) {
          ctx.strokeStyle = '#d36735'
          ctx.lineWidth = 3 / viewport.scale
          ctx.stroke(
            new Path2D(new RenderGenerator([selected], {}, size).toString())
          )
        }
      }
      this.dot(tool.target.point, 7, '#d36735')
    }
    if (this.pointer) {
      ctx.beginPath()
      ctx.arc(
        this.pointer.x,
        this.pointer.y,
        7 / viewport.scale,
        0,
        Math.PI * 2
      )
      ctx.strokeStyle = '#238673'
      ctx.lineWidth = 1 / viewport.scale
      ctx.stroke()
    }
    ctx.restore()
    this.metrics.frames++
    this.metrics.pathBuilds = this.cache.builds
    this.metrics.samples.push(performance.now() - start)
    if (lastFrame && time - lastFrame < 1000)
      this.metrics.frameGaps.push(time - lastFrame)
    lastFrame = time
    if (this.metrics.samples.length > 1800) this.metrics.samples.shift()
    if (this.metrics.frameGaps.length > 1800) this.metrics.frameGaps.shift()
  }
  this.drawGrid = (size) => {
    const ctx = this.context
    const v = client.viewport
    // Only visible dots, thinning at low zoom to keep work bounded.
    const interval = v.scale < 0.4 ? 60 : 15
    const startX = Math.max(
      interval,
      Math.ceil(-v.x / v.scale / interval) * interval
    )
    const startY = Math.max(
      interval,
      Math.ceil(-v.y / v.scale / interval) * interval
    )
    const endX = Math.min(size.width, (v.width - v.x) / v.scale)
    const endY = Math.min(size.height, (v.height - v.y) / v.scale)
    ctx.fillStyle = '#c9d2c9'
    ctx.beginPath()
    for (let x = startX; x < endX; x += interval)
      for (let y = startY; y < endY; y += interval) {
        const radius = (x % 60 === 0 && y % 60 === 0 ? 1.4 : 0.9) / v.scale
        ctx.moveTo(x + radius, y)
        ctx.arc(x, y, radius, 0, Math.PI * 2)
      }
    ctx.fill()
  }
  this.dot = (point, radius, color) => {
    const ctx = this.context
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius / client.viewport.scale, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }
}
if (typeof module !== 'undefined') module.exports = { LayerPathCache, Renderer }
