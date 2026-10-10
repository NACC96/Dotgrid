'use strict'
const ToolGenerator =
  typeof module !== 'undefined' ? require('./generator.js') : Generator
const cloneToolData =
  typeof module !== 'undefined'
    ? require('./document.js').copyDocument
    : copyDocument

function Tool(client) {
  this.index = 0
  this.vertices = []
  this.operation = 'line'
  this.mode = 'draw'
  this.target = null
  this.hits = []
  this.preview = null
  this.deletionCount = 0
  let gesture = null
  const refresh = () => client.update()
  for (const key of ['settings', 'layers', 'styles'])
    Object.defineProperty(this, key, { get: () => client.document.data[key] })
  this.layer = (index = this.index) => this.layers[index]
  this.style = () => this.styles[this.index]
  this.renderDocument = () => this.preview || client.document.data
  this.length = () => this.layers.reduce((n, layer) => n + layer.length, 0)
  this.clear = () => {
    this.vertices = []
    this.cancel()
    this.target = null
    this.hits = []
    refresh()
  }
  this.cancel = () => {
    gesture = null
    this.preview = null
    this.deletionCount = 0
    refresh()
  }
  this.removeLastPoint = () => {
    this.vertices.pop()
    refresh()
  }
  this.canCast = (type = this.operation) => {
    if (type === 'close')
      return (
        this.vertices.length === 0 &&
        this.layer().length > 0 &&
        this.layer().at(-1).type !== 'close'
      )
    if (type === 'bezier') return [3, 5, 7, 9].includes(this.vertices.length)
    return (
      ['line', 'arc_c', 'arc_r', 'arc_c_full', 'arc_r_full'].includes(type) &&
      this.vertices.length >= 2
    )
  }
  this.addVertex = (pos) => {
    this.vertices.push({ x: pos.x, y: pos.y })
    refresh()
  }
  this.cast = (type = this.operation) => {
    if (!this.canCast(type)) return false
    const points = cloneToolData(this.vertices)
    client.document.edit('Apply ' + type, (data) => {
      const layer = data.layers[this.index]
      const append = points.length
        ? layer.findIndex(
            (segment) =>
              segment.type === type &&
              segment.vertices.length &&
              (type !== 'bezier' || segment.vertices.length % 2 === 1) &&
              segment.vertices.at(-1).x === points[0].x &&
              segment.vertices.at(-1).y === points[0].y
          )
        : -1
      if (append >= 0) layer[append].vertices.push(...(type === 'bezier' ? points.slice(1) : points))
      else layer.push({ type, vertices: points })
    })
    this.clear()
    return true
  }
  this.setStyle = (key, value) => {
    client.document.edit('Change ' + key, (data) => {
      data.styles[this.index][key] = value
    })
    refresh()
  }
  this.merge = () => {
    client.document.edit('Merge layers', (data) => {
      const layer = data.layers[2].concat(data.layers[1], data.layers[0])
      data.layers = [[], [], []]
      data.layers[this.index] = layer
    })
    this.clear()
  }
  this.erase = () => {
    client.document.edit('Clear drawing', (data) => {
      data.layers = [[], [], []]
    })
    this.clear()
  }
  this.setSize = (width, height) => {
    client.document.edit('Document size', (data) => {
      data.settings.size = { width, height }
      if (Object.hasOwn(data.settings, 'width')) data.settings.width = width
      if (Object.hasOwn(data.settings, 'height')) data.settings.height = height
    })
    refresh()
  }
  this.paths = (data = this.renderDocument()) =>
    data.layers.map((layer, index) =>
      new ToolGenerator(
        layer,
        data.styles[index],
        data.settings.size
      ).toString()
    )
  this.path = () =>
    new ToolGenerator(this.layer(), this.style(), this.settings.size).toString()
  this.export = () => JSON.stringify(client.document.snapshot(), null, 2)
  this.hitAt = (pos) => {
    const tolerance = 14 / client.viewport.scale
    const hits = []
    this.layer().forEach((segment, segmentId) =>
      segment.vertices.forEach((point, vertexId) => {
        const distance = Math.hypot(point.x - pos.x, point.y - pos.y)
        if (distance <= tolerance)
          hits.push({ segmentId, vertexId, point: { ...point }, distance })
      })
    )
    hits.sort(
      (a, b) =>
        a.distance - b.distance ||
        a.segmentId - b.segmentId ||
        a.vertexId - b.vertexId
    )
    // A shared coordinate has one point target, with one candidate for each segment.
    const seenSegments = new Set()
    const candidates = hits.filter((hit) => {
      if (seenSegments.has(hit.segmentId)) return false
      seenSegments.add(hit.segmentId)
      return true
    })
    this.hits = candidates
    const previous = this.target
    this.target =
      candidates.find(
        (hit) =>
          previous &&
          hit.segmentId === previous.segmentId &&
          hit.point.x === previous.point.x &&
          hit.point.y === previous.point.y
      ) ||
      candidates[0] ||
      null
    return this.target
  }
  this.cycleTarget = () => {
    if (this.hits.length)
      this.target =
        this.hits[(this.hits.indexOf(this.target) + 1) % this.hits.length]
    this.preview = null
    this.deletionCount = 0
    refresh()
  }
  this.begin = (pos, hitPosition = pos) => {
    this.cancel()
    if (this.mode === 'draw') {
      gesture = { from: pos }
      return true
    }
    const target = this.hitAt(hitPosition)
    if (this.mode !== 'move-layer' && !target) {
      refresh()
      return false
    }
    gesture = {
      from: pos,
      target: target && cloneToolData(target),
      original: client.document.snapshot()
    }
    refresh()
    return true
  }
  this.move = (pos) => {
    if (
      !gesture ||
      (!this.mode.startsWith('move') && this.mode !== 'duplicate')
    )
      return
    if (
      gesture.lastPosition &&
      gesture.lastPosition.x === pos.x &&
      gesture.lastPosition.y === pos.y
    )
      return
    gesture.lastPosition = { ...pos }
    const dx = pos.x - gesture.from.x
    const dy = pos.y - gesture.from.y
    const draft = cloneToolData(gesture.original)
    const layer = draft.layers[this.index]
    if (this.mode === 'duplicate')
      layer.push(cloneToolData(layer[gesture.target.segmentId]))
    layer.forEach((segment, id) =>
      segment.vertices.forEach((point) => {
        const selected =
          this.mode === 'move-layer' ||
          (this.mode === 'move-segment' && id === gesture.target.segmentId) ||
          (this.mode === 'duplicate' && id === layer.length - 1) ||
          (this.mode === 'move-point' &&
            point.x === gesture.target.point.x &&
            point.y === gesture.target.point.y)
        if (selected) {
          point.x += dx
          point.y += dy
        }
      })
    )
    this.preview = draft
    refresh()
  }
  this.end = (pos) => {
    if (!gesture) return
    try {
      if (this.mode === 'draw') this.addVertex(pos)
      else if (this.mode.startsWith('delete')) this.previewDelete()
      else {
        this.move(pos)
        const draft = this.preview
        if (draft)
          client.document.edit(this.mode, (data) => {
            data.layers[this.index] = draft.layers[this.index]
          })
      }
    } finally {
      gesture = null
      if (!this.mode.startsWith('delete')) this.preview = null
      refresh()
    }
  }
  this.previewDelete = () => {
    if (!this.target) return
    const draft = client.document.snapshot()
    const original = draft.layers[this.index]
    let removed = 0
    const remaining = []
    let previousSurvived = false
    original.forEach((segment, id) => {
      if (segment.type === 'close') {
        if (
          previousSurvived &&
          remaining.length &&
          remaining.at(-1).type !== 'close'
        )
          remaining.push(segment)
        else removed++
        previousSurvived = false
        return
      }
      const matches = segment.vertices.some(
        (point) =>
          point.x === this.target.point.x && point.y === this.target.point.y
      )
      if (this.mode === 'delete-segment' && id === this.target.segmentId) {
        removed++
        previousSurvived = false
        return
      }
      if (
        this.mode === 'delete-point' &&
        matches &&
        segment.type === 'bezier'
      ) {
        // Generator consumes overlapping start/control/end triples, even for
        // accumulated legacy arrays. Keep unaffected triples as their own
        // subpaths so deleting a handle never reassigns another curve's role.
        const fragments = []
        let current = null
        for (let at = 0; at + 2 < segment.vertices.length; at += 2) {
          const triple = segment.vertices.slice(at, at + 3)
          if (
            triple.some(
              (point) =>
                point.x === this.target.point.x &&
                point.y === this.target.point.y
            )
          ) {
            current = null
            continue
          }
          if (current) current.vertices.push(...triple.slice(1))
          else {
            current = { ...segment, vertices: triple }
            fragments.push(current)
          }
        }
        remaining.push(...fragments)
        if (!fragments.length) removed++
        previousSurvived = false
        return
      }
      if (this.mode === 'delete-point' && matches)
        segment.vertices = segment.vertices.filter(
          (point) =>
            point.x !== this.target.point.x || point.y !== this.target.point.y
        )
      previousSurvived = segment.vertices.length >= 2
      if (!previousSurvived) removed++
      else remaining.push(segment)
    })
    draft.layers[this.index] = remaining
    this.deletionCount = removed
    this.preview = draft
    refresh()
  }
  this.applyDelete = () => {
    if (!this.preview) return false
    const layer = this.preview.layers[this.index]
    client.document.edit('Delete selection', (data) => {
      data.layers[this.index] = layer
    })
    this.clear()
    return true
  }
}
if (typeof module !== 'undefined') module.exports = Tool
