'use strict'
function Interface(client) {
  this.el = document.createElement('div')
  this.el.id = 'interface'
  const fieldDrafts = new Set()
  this.resetDrafts = () => fieldDrafts.clear()
  const primitives = [
    ['line', 'Line'],
    ['arc_c', 'Arc clockwise'],
    ['arc_r', 'Arc reverse'],
    ['arc_c_full', 'Large arc clockwise'],
    ['arc_r_full', 'Large arc reverse'],
    ['bezier', 'Quadratic Bézier']
  ]
  const modes = [
    ['draw', 'Add points'],
    ['move-point', 'Move shared point'],
    ['move-segment', 'Move segment'],
    ['duplicate', 'Duplicate segment'],
    ['move-layer', 'Move layer'],
    ['delete-point', 'Delete shared point'],
    ['delete-segment', 'Delete segment']
  ]
  const options = (items) =>
    items
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join('')
  this.el.innerHTML = `
    <header><div class="brand">dotgrid<span>iPad</span></div><button id="projects" class="project-button">Drawing</button><span id="save-status" role="status" aria-live="polite">Starting…</span><button id="export">Export</button><button id="details-toggle" aria-expanded="false" aria-controls="details">Settings</button></header>
    <nav aria-label="Drawing tools" class="tools">
      <label>Tool<select id="mode">${options(modes)}</select></label>
      <label>Stroke<select id="primitive">${options(primitives)}</select></label>
      <button id="apply" class="primary">Apply</button><button id="close-path">Close path</button><button id="remove-point">Remove last point</button><button id="cancel">Cancel</button>
      <span class="separator"></span><button id="undo">Undo</button><button id="redo">Redo</button>
    </nav>
    <section class="canvas-area" aria-label="Editor"><div id="canvas-host"></div>
      <aside id="details" hidden>
        <h2>Layer style</h2><label>Color<input id="color" type="color"></label><div class="row"><button id="color-apply">Apply color</button><button id="color-cancel">Cancel color</button></div>
        <label>Thickness<input id="thickness" type="number" min="1" max="100" step="1"></label>
        <label>Line cap<select id="cap">${options([
          ['butt', 'Butt'],
          ['round', 'Round'],
          ['square', 'Square']
        ])}</select></label>
        <label>Line join<select id="join">${options([
          ['miter', 'Miter'],
          ['round', 'Round'],
          ['bevel', 'Bevel']
        ])}</select></label>
        <button id="fill">Fill off</button><label>Mirror<select id="mirror">${options(
          [
            ['0', 'None'],
            ['1', 'Horizontal'],
            ['2', 'Vertical'],
            ['3', 'Both axes']
          ]
        )}</select></label>
        <h2>Document</h2><div class="row"><label>Width<input id="width" type="number" min="15" max="10000" step="15"></label><label>Height<input id="height" type="number" min="15" max="10000" step="15"></label></div>
        <button id="size-apply">Apply dimensions</button><button id="merge">Merge all layers</button><button id="erase" class="danger">Clear drawing</button>
        <h2>App</h2><p id="offline-status" role="status">Checking offline cache…</p><button id="update-app" hidden>Save and update</button><button id="repair">Repair offline cache</button><button id="diagnostics">Diagnostics</button><p class="small">Local projects stay on this device. Export .grid backups to Files.</p>
      </aside>
    </section>
    <footer><div class="layers" role="group" aria-label="Active layer"><button id="layer-0">1 · Front</button><button id="layer-1">2 · Middle</button><button id="layer-2">3 · Back</button></div><span id="construction-status" role="status"></span><button id="cycle-target" hidden>Next target</button><button id="delete-apply" class="danger" hidden>Apply deletion</button><button id="touch-mode" aria-pressed="false">Pencil</button><button id="grid" aria-pressed="true">Grid</button><button id="fit">Fit</button></footer>
    <div id="notice" role="status" aria-live="polite"></div>`
  this.get = (id) => this.el.querySelector('#' + id)
  const click = (id, fn) =>
    this.get(id).addEventListener('click', () =>
      Promise.resolve(fn()).catch(client.reportError)
    )
  const change = (id, fn) =>
    this.get(id).addEventListener('change', () =>
      Promise.resolve(fn()).catch(client.reportError)
    )
  this.install = (host) => {
    host.append(this.el)
    this.get('canvas-host').append(client.renderer.el)
    for (const id of [
      'color',
      'thickness',
      'cap',
      'join',
      'mirror',
      'width',
      'height'
    ])
      this.get(id).addEventListener('input', () => fieldDrafts.add(id))
    click('projects', () => client.showProjects())
    click('export', () => client.showExport())
    click('details-toggle', () => {
      client.input.cancelAll()
      const details = this.get('details')
      details.hidden = !details.hidden
      this.get('details-toggle').setAttribute(
        'aria-expanded',
        String(!details.hidden)
      )
    })
    change('mode', () => {
      const value = this.get('mode').value
      return client.contextChange(() => {
        client.tool.clear()
        client.tool.mode = value
      })
    })
    change('primitive', () => {
      const value = this.get('primitive').value
      return client.contextChange(() => {
        client.tool.operation = value
      })
    })
    click('apply', () => client.perform(() => client.tool.cast()))
    click('close-path', () => client.perform(() => client.tool.cast('close')))
    click('remove-point', () =>
      client.perform(() => client.tool.removeLastPoint())
    )
    click('cancel', () => client.perform(() => client.tool.clear()))
    click('undo', () =>
      client.contextChange(() => {
        client.tool.clear()
        client.document.undo()
      })
    )
    click('redo', () =>
      client.contextChange(() => {
        client.tool.clear()
        client.document.redo()
      })
    )
    for (let index = 0; index < 3; index++)
      click('layer-' + index, () =>
        client.contextChange(() => {
          client.tool.clear()
          client.tool.index = index
          fieldDrafts.clear()
        })
      )
    click('color-apply', () => {
      const value = this.get('color').value
      fieldDrafts.delete('color')
      return client.perform(() => client.tool.setStyle('color', value))
    })
    click('color-cancel', () => {
      fieldDrafts.delete('color')
      this.get('color').value = client.tool.style().color
    })
    change('thickness', () => {
      const value = Number(this.get('thickness').value)
      fieldDrafts.delete('thickness')
      return client.perform(() => {
        if (Number.isFinite(value) && value >= 1 && value <= 100)
          client.tool.setStyle('thickness', value)
      })
    })
    change('cap', () => {
      const value = this.get('cap').value
      fieldDrafts.delete('cap')
      return client.perform(() => client.tool.setStyle('strokeLinecap', value))
    })
    change('join', () => {
      const value = this.get('join').value
      fieldDrafts.delete('join')
      return client.perform(() => client.tool.setStyle('strokeLinejoin', value))
    })
    change('mirror', () => {
      const value = Number(this.get('mirror').value)
      fieldDrafts.delete('mirror')
      return client.perform(() => client.tool.setStyle('mirror_style', value))
    })
    click('fill', () =>
      client.perform(() =>
        client.tool.setStyle(
          'fill',
          client.tool.style().fill === 'none'
            ? client.tool.style().color
            : 'none'
        )
      )
    )
    click('size-apply', () => {
      const width = Number(this.get('width').value)
      const height = Number(this.get('height').value)
      return client.contextChange(() => {
        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width < 15 ||
          height < 15 ||
          width > 10000 ||
          height > 10000
        ) {
          client.notice('Dimensions must be between 15 and 10000.')
          return
        }
        fieldDrafts.delete('width')
        fieldDrafts.delete('height')
        client.tool.setSize(width, height)
        client.fit()
      })
    })
    click('merge', () =>
      client.contextChange(async () => {
        if (
          await this.confirm(
            'Merge layers?',
            'The merged artwork uses the active layer’s style. Undo can restore the separate layers.'
          )
        )
          client.tool.merge()
      })
    )
    click('erase', () =>
      client.contextChange(async () => {
        if (
          await this.confirm(
            'Clear drawing?',
            'This removes artwork from all three layers. Undo can restore it.'
          )
        )
          client.tool.erase()
      })
    )
    click('cycle-target', () =>
      client.perform(() => {
        client.tool.cycleTarget()
        if (client.tool.mode.startsWith('delete')) client.tool.previewDelete()
      })
    )
    click('delete-apply', () => client.perform(() => client.tool.applyDelete()))
    click('touch-mode', () =>
      client.contextChange(() => {
        client.touchEditing = !client.touchEditing
        client.input.setTouchEditing(client.touchEditing)
      })
    )
    click('grid', () => client.renderer.toggle())
    click('fit', () => client.fit())
    click('update-app', () => client.pwa.saveAndUpdate())
    click('repair', async () => {
      if (
        await this.confirm(
          'Repair offline cache?',
          'This refreshes application files. Local artwork is retained. Internet is required.'
        )
      )
        await client.pwa.repair()
    })
    click('diagnostics', () => client.showDiagnostics())
  }
  this.update = () => {
    const tool = client.tool
    const style = tool.style()
    this.get('projects').textContent = client.projectName || 'Drawing'
    this.get('save-status').textContent = client.saveState
    this.get('primitive').value = tool.operation
    this.get('mode').value = tool.mode
    this.get('apply').disabled =
      client.editFrozen || tool.mode !== 'draw' || !tool.canCast()
    this.get('close-path').disabled =
      client.editFrozen || !tool.canCast('close')
    this.get('remove-point').disabled =
      !tool.vertices.length || client.editFrozen
    this.get('cancel').disabled =
      !tool.vertices.length && !tool.preview && !tool.target
    this.get('undo').disabled =
      !client.document.history.canUndo || client.editFrozen
    this.get('redo').disabled =
      !client.document.history.canRedo || client.editFrozen
    for (let index = 0; index < 3; index++)
      this.get('layer-' + index).setAttribute(
        'aria-pressed',
        String(tool.index === index)
      )
    this.get('touch-mode').textContent = client.touchEditing
      ? 'Touch editing'
      : 'Pencil'
    this.get('touch-mode').setAttribute(
      'aria-pressed',
      String(client.touchEditing)
    )
    this.get('grid').setAttribute(
      'aria-pressed',
      String(client.renderer.showExtras)
    )
    this.get('construction-status').textContent = tool.vertices.length
      ? `${tool.vertices.length} pending point${tool.vertices.length === 1 ? '' : 's'} · Apply to keep`
      : tool.target
        ? `Segment ${tool.target.segmentId + 1}${tool.mode === 'move-point' || tool.mode === 'delete-point' ? ' · shared point' : ''}`
        : '15-unit grid'
    this.get('cycle-target').hidden = tool.hits.length < 2
    this.get('delete-apply').hidden =
      !tool.mode.startsWith('delete') || !tool.preview
    this.get('delete-apply').textContent =
      `Apply deletion${tool.deletionCount ? ' · ' + tool.deletionCount + ' segment' + (tool.deletionCount === 1 ? '' : 's') : ''}`
    for (const [id, value] of Object.entries({
      color: style.color,
      thickness: style.thickness,
      cap: style.strokeLinecap,
      join: style.strokeLinejoin,
      mirror: style.mirror_style,
      width: tool.settings.size.width,
      height: tool.settings.size.height
    })) {
      const el = this.get(id)
      if (!fieldDrafts.has(id) && document.activeElement !== el)
        el.value = value
    }
    this.get('fill').textContent =
      style.fill === 'none' ? 'Fill off' : 'Fill on'
    this.get('fill').setAttribute('aria-pressed', String(style.fill !== 'none'))
    if (client.pwa) {
      this.get('offline-status').textContent = client.pwa.status
      this.get('update-app').hidden = !client.pwa.updateAvailable
    }
  }
  this.dialog = (title, message, choices, fields = []) =>
    new Promise((resolve) => {
      client.input.cancelAll()
      const dialog = document.createElement('dialog')
      dialog.className = 'sheet'
      const heading = document.createElement('h2')
      heading.textContent = title
      dialog.append(heading)
      const id = 'dialog-title-' + Date.now()
      heading.id = id
      dialog.setAttribute('aria-labelledby', id)
      const paragraph = document.createElement('p')
      paragraph.textContent = message
      dialog.append(paragraph)
      const values = {}
      for (const field of fields) {
        const label = document.createElement('label')
        label.textContent = field.label
        const input = document.createElement('input')
        input.type = 'text'
        input.value = field.value || ''
        input.maxLength = 120
        label.append(input)
        dialog.append(label)
        values[field.id] = input
      }
      const buttons = document.createElement('div')
      buttons.className = 'dialog-actions'
      dialog.append(buttons)
      let settled = false
      const finish = (choice) => {
        if (settled) return
        settled = true
        const result = {
          choice,
          values: Object.fromEntries(
            Object.entries(values).map(([key, input]) => [
              key,
              input.value.trim()
            ])
          )
        }
        dialog.close()
        dialog.remove()
        resolve(result)
      }
      for (const choice of choices) {
        const button = document.createElement('button')
        button.textContent = choice.label
        button.className = choice.danger
          ? 'danger'
          : choice.primary
            ? 'primary'
            : ''
        button.addEventListener('click', () => finish(choice.id))
        buttons.append(button)
      }
      dialog.addEventListener('cancel', (e) => {
        e.preventDefault()
        finish(null)
      })
      document.body.append(dialog)
      dialog.showModal()
      ;(Object.values(values)[0] || buttons.lastElementChild).focus()
    })
  this.confirm = async (title, message) =>
    (
      await this.dialog(title, message, [
        { id: 'yes', label: 'Confirm', danger: true },
        { id: 'cancel', label: 'Cancel' }
      ])
    ).choice === 'yes'
}
