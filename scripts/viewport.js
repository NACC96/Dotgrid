'use strict'
function Viewport () {
  this.scale = 1
  this.x = 0
  this.y = 0
  this.width = 0
  this.height = 0
  this.toDocument = p => ({ x: (p.x - this.x) / this.scale, y: (p.y - this.y) / this.scale })
  this.toScreen = p => ({ x: p.x * this.scale + this.x, y: p.y * this.scale + this.y })
  this.fit = (size, width = this.width, height = this.height) => {
    this.width = width
    this.height = height
    this.scale = Math.max(0.02, Math.min((width - 64) / size.width, (height - 64) / size.height, 8))
    this.x = (width - size.width * this.scale) / 2
    this.y = (height - size.height * this.scale) / 2
  }
  this.resize = (width, height) => {
    const center = this.toDocument({ x: this.width / 2, y: this.height / 2 })
    this.width = width
    this.height = height
    this.x = width / 2 - center.x * this.scale
    this.y = height / 2 - center.y * this.scale
  }
  this.zoomAt = (scale, point) => {
    const model = this.toDocument(point)
    this.scale = Math.max(0.02, Math.min(scale, 24))
    this.x = point.x - model.x * this.scale
    this.y = point.y - model.y * this.scale
  }
}
if (typeof module !== 'undefined') module.exports = Viewport
