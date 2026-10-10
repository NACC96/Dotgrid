'use strict'

function InputController (el, { viewport, onBegin = () => false, onMove = () => {}, onEnd = () => {}, onCancel = () => {}, onHover = () => {}, onViewChange = () => {} }) {
  const contacts = new Map()
  let editing = null
  let gesture = null
  let touchEditing = false

  // Browser gesture policy must be in place before the first contact.
  el.style.touchAction = 'none'
  Object.defineProperty(this, 'active', { get: () => contacts.size > 0 })

  const pointAt = event => {
    const rect = el.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const touches = () => Array.from(contacts.values()).filter(contact => contact.type === 'touch' && !contact.ignored)
  const centerOf = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const distanceOf = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
  const transform = () => ({ x: viewport.x, y: viewport.y, scale: viewport.scale })
  const viewChanged = (before, point, event) => {
    if (before.x !== viewport.x || before.y !== viewport.y || before.scale !== viewport.scale) onViewChange(point, event)
  }

  const release = contact => {
    if (el.hasPointerCapture(contact.id)) el.releasePointerCapture(contact.id)
  }
  const cancelEdit = event => {
    if (!editing) return
    const contact = editing
    editing = null
    onCancel(contact.point, event || contact.event)
  }
  const beginEdit = contact => {
    // The caller owns the tentative preview; only onEnd may commit it.
    if (onBegin(contact.point, contact.event) === true) editing = contact
  }
  const beginGesture = () => {
    const pair = touches().slice(0, 2)
    if (pair.length < 2) { gesture = null; return }
    const center = centerOf(pair[0].point, pair[1].point)
    gesture = {
      ids: pair.map(contact => contact.id),
      center,
      anchor: viewport.toDocument(center),
      scale: viewport.scale,
      distance: distanceOf(pair[0].point, pair[1].point) || 1
    }
  }
  const moveGesture = event => {
    const pair = gesture.ids.map(id => contacts.get(id))
    const center = centerOf(pair[0].point, pair[1].point)
    const before = transform()
    viewport.zoomAt(gesture.scale * distanceOf(pair[0].point, pair[1].point) / gesture.distance, gesture.center)
    viewport.x = center.x - gesture.anchor.x * viewport.scale
    viewport.y = center.y - gesture.anchor.y * viewport.scale
    viewChanged(before, center, event)
  }

  this.setTouchEditing = enabled => {
    touchEditing = Boolean(enabled)
    if (!touchEditing && editing?.type === 'touch') cancelEdit()
  }
  this.cancelAll = () => {
    const previous = Array.from(contacts.values())
    contacts.clear()
    gesture = null
    cancelEdit()
    // Forget ownership before release emits lostpointercapture.
    for (const contact of previous) release(contact)
  }

  el.addEventListener('pointerdown', event => {
    const type = event.pointerType || 'mouse'
    if (!['mouse', 'pen', 'touch'].includes(type) || contacts.has(event.pointerId)) return
    if (type !== 'touch' && event.button !== 0) return
    event.preventDefault()
    const contact = { id: event.pointerId, type, point: pointAt(event), event, ignored: false }
    contacts.set(contact.id, contact)
    try {
      el.setPointerCapture(contact.id)
    } catch (error) {
      contacts.delete(contact.id)
      return
    }

    if (type === 'pen') {
      cancelEdit(event)
      gesture = null
      for (const other of contacts.values()) if (other.type === 'touch') other.ignored = true
      beginEdit(contact)
    } else if (type === 'mouse') {
      if (editing || gesture || Array.from(contacts.values()).some(other => other.type === 'pen')) return
      for (const other of contacts.values()) if (other.type === 'touch') other.ignored = true
      beginEdit(contact)
    } else {
      if (Array.from(contacts.values()).some(other => other.type === 'pen' || (other.type === 'touch' && other.ignored)) || (editing && editing.type !== 'touch')) {
        contact.ignored = true
        return
      }
      if (touches().length >= 2) {
        cancelEdit(event)
        if (!gesture) beginGesture()
      } else if (touchEditing) beginEdit(contact)
    }
  })

  el.addEventListener('pointermove', event => {
    const contact = contacts.get(event.pointerId)
    if (!contact) {
      if (!editing && !gesture && event.buttons === 0 && ['mouse', 'pen'].includes(event.pointerType || 'mouse')) onHover(pointAt(event), event)
      return
    }
    event.preventDefault()
    contact.point = pointAt(event)
    contact.event = event
    if (editing === contact) onMove(contact.point, event)
    else if (gesture?.ids.includes(contact.id)) moveGesture(event)
  })

  el.addEventListener('pointerup', event => {
    const contact = contacts.get(event.pointerId)
    if (!contact) return
    event.preventDefault()
    contact.point = pointAt(event)
    contact.event = event
    if (gesture?.ids.includes(contact.id)) moveGesture(event)
    const completed = editing === contact
    if (completed) editing = null
    contacts.delete(contact.id)
    if (gesture?.ids.includes(contact.id)) beginGesture()
    release(contact)
    if (completed) onEnd(contact.point, event)
  })

  const interrupt = event => {
    const contact = contacts.get(event.pointerId)
    if (!contact) return
    if (editing === contact) cancelEdit(event)
    if (gesture?.ids.includes(contact.id)) {
      gesture = null
      // Remaining fingers must lift before they can start another action.
      for (const other of touches()) other.ignored = true
    }
    contacts.delete(contact.id)
    release(contact)
  }
  el.addEventListener('pointercancel', interrupt)
  el.addEventListener('lostpointercapture', interrupt)

  el.addEventListener('wheel', event => {
    event.preventDefault()
    if (this.active) return
    const point = pointAt(event)
    const before = transform()
    const unitX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.width : 1
    const unitY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1
    if (event.ctrlKey) viewport.zoomAt(viewport.scale * Math.exp(-event.deltaY * unitY * 0.01), point)
    else {
      viewport.x -= event.deltaX * unitX
      viewport.y -= event.deltaY * unitY
    }
    viewChanged(before, point, event)
  }, { passive: false })
}

if (typeof module !== 'undefined') module.exports = InputController
