'use strict'

function History (capacity = 20) {
  this.capacity = capacity
  this.index = -1
  this.a = []
  const copy = data => data == null ? null : JSON.parse(JSON.stringify(data))
  this.clear = () => { this.a = []; this.index = -1 }
  this.reset = data => { this.a = [copy(data)]; this.index = 0 }
  this.push = data => {
    this.a = this.a.slice(0, this.index + 1)
    this.a.push(copy(data))
    if (this.a.length > this.capacity + 1) this.a.shift()
    this.index = this.a.length - 1
  }
  this.prev = () => {
    if (this.index <= 0) return null
    return copy(this.a[--this.index])
  }
  this.next = () => {
    if (this.index >= this.a.length - 1) return null
    return copy(this.a[++this.index])
  }
  Object.defineProperties(this, {
    canUndo: { get: () => this.index > 0 },
    canRedo: { get: () => this.index < this.a.length - 1 }
  })
}
if (typeof module !== 'undefined') module.exports = History
