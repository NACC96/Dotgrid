'use strict'
const DocumentHistory = typeof module !== 'undefined' ? require('./lib/history.js') : History
const copyDocument = data => JSON.parse(JSON.stringify(data))

function GridDocument (data = GridDocument.empty()) {
  this.data = copyDocument(data)
  this.revision = 0
  this.history = new DocumentHistory(20)
  this.history.reset(this.data)
  const listeners = new Set()
  this.subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
  const notify = (label, kind) => { for (const listener of listeners) listener({ revision: this.revision, label, kind }) }
  this.snapshot = () => copyDocument(this.data)
  this.reset = next => {
    this.data = copyDocument(next)
    this.revision = 0
    this.history.reset(this.data)
    notify('Open project', 'reset')
  }
  this.edit = (label, mutate) => {
    const draft = this.snapshot()
    mutate(draft)
    const validator = typeof module !== 'undefined' ? require('./projects.js').ProjectLibrary : ProjectLibrary
    const validated = validator.validate(draft)
    if (JSON.stringify(validated) === JSON.stringify(this.data)) return false
    this.data = validated
    this.history.push(validated)
    this.revision++
    notify(label, 'edit')
    return true
  }
  this.undo = () => {
    const data = this.history.prev()
    if (!data) return false
    this.data = data
    this.revision++
    notify('Undo', 'edit')
    return true
  }
  this.redo = () => {
    const data = this.history.next()
    if (!data) return false
    this.data = data
    this.revision++
    notify('Redo', 'edit')
    return true
  }
}
GridDocument.empty = () => ({
  settings: { size: { width: 600, height: 300 } },
  layers: [[], [], []],
  styles: ['#18282c', '#238673', '#b86640'].map(color => ({ thickness: 3, strokeLinecap: 'round', strokeLinejoin: 'round', color, fill: 'none', mirror_style: 0 }))
})
if (typeof module !== 'undefined') module.exports = { GridDocument, copyDocument }
