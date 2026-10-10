'use strict'
function Client() {
  this.document = new GridDocument()
  this.viewport = new Viewport()
  this.tool = new Tool(this)
  this.renderer = new Renderer(this)
  this.manager = new Manager(this)
  this.source = new Source(this)
  this.library = new ProjectLibrary()
  this.interface = new Interface(this)
  this.projectName = 'Untitled'
  this.record = null
  this.saveState = 'Starting…'
  this.savedDocumentRevision = -1
  this.editFrozen = false
  this.touchEditing = false
  this.conflict = false
  this.recoveryPending = false
  this._saving = null
  let saveTimer = 0
  let noticeTimer = 0
  let projectGeneration = 0
  const formTarget = (target) =>
    target &&
    (target.closest('input,select,textarea,[contenteditable=true]') ||
      target.closest('dialog'))
  this.notice = (message) => {
    const el = this.interface.get('notice')
    el.textContent = message
    el.classList.add('visible')
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => el.classList.remove('visible'), 6500)
  }
  this.reportError = (error) => {
    console.warn(error)
    this.notice(error.message || String(error))
  }
  this.update = () => {
    this.renderer.update()
    this.interface.update()
  }
  this.snap = (point) => {
    const pos = this.viewport.toDocument(point)
    return { x: Math.round(pos.x / 15) * 15, y: Math.round(pos.y / 15) * 15 }
  }
  this.fit = () => {
    this.input.cancelAll()
    this.viewport.fit(this.tool.settings.size)
    this.update()
  }
  this.perform = (action) => {
    if (this.editFrozen) return false
    this.input.cancelAll()
    try { return action() }
    catch (error) { this.reportError(error); return false }
    finally { this.update() }
  }
  this.guardPending = async () => {
    if (!this.tool.vertices.length) return true
    const choices = []
    if (this.tool.canCast())
      choices.push({ id: 'finish', label: 'Finish', primary: true })
    choices.push(
      { id: 'discard', label: 'Discard points', danger: true },
      { id: 'stay', label: 'Stay' }
    )
    const result = await this.interface.dialog(
      'Unfinished construction',
      'These points are not part of the saved drawing yet.',
      choices
    )
    if (result.choice === 'finish') return this.tool.cast()
    if (result.choice === 'discard') {
      this.tool.clear()
      return true
    }
    return false
  }
  this.contextChange = async (action) => {
    if (this.editFrozen) return false
    this.input.cancelAll()
    if (!(await this.guardPending())) {
      this.update()
      return false
    }
    this.tool.cancel()
    const result = await action()
    this.update()
    return result
  }
  this.install = (host) => {
    this.input = new InputController(this.renderer.el, {
      viewport: this.viewport,
      onBegin: (point) => {
        if (this.editFrozen) return false
        const pos = this.snap(point)
        const { width, height } = this.tool.settings.size
        if (
          this.tool.mode === 'draw' &&
          (pos.x < 0 || pos.y < 0 || pos.x > width || pos.y > height)
        )
          return false
        this.renderer.pointer = pos
        return this.tool.begin(pos, this.viewport.toDocument(point))
      },
      onMove: (point) => {
        const pos = this.snap(point)
        this.renderer.pointer = pos
        this.tool.move(pos)
        this.renderer.update()
      },
      onEnd: (point) => {
        const pos = this.snap(point)
        const { width, height } = this.tool.settings.size
        if (
          this.tool.mode === 'draw' &&
          (pos.x < 0 || pos.y < 0 || pos.x > width || pos.y > height)
        )
          this.tool.cancel()
        else {
          try { this.tool.end(pos) }
          catch (error) { this.tool.cancel(); this.reportError(error) }
        }
        this.renderer.pointer = null
        this.update()
      },
      onCancel: () => {
        this.tool.cancel()
        this.renderer.pointer = null
        this.update()
      },
      onHover: (point) => {
        this.renderer.pointer = this.snap(point)
        this.renderer.update()
      },
      onViewChange: () => {
        this.renderer.pointer = null
        this.renderer.update()
      }
    })
    this.interface.install(host)
    this.document.subscribe((event) => {
      if (event.kind === 'edit') {
        this.saveState = this.conflict ? 'Conflict' : 'Saving'
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => this.saveDraft(), 40)
      }
      this.update()
    })
    new ResizeObserver(() => {
      this.input.cancelAll()
      this.renderer.resize()
    }).observe(this.renderer.el)
    window.addEventListener('resize', () => {
      this.input.cancelAll()
      this.renderer.resize()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.input.cancelAll()
        this.saveDraft()
      }
    })
    window.addEventListener('pagehide', () => {
      this.input.cancelAll()
      this.saveDraft()
    })
    document.addEventListener('keydown', this.keyDown)
    for (const type of ['copy', 'cut', 'paste'])
      document.addEventListener(type, (event) => this.clipboard(type, event))
    this.renderer.el.addEventListener('contextmenu', (event) =>
      event.preventDefault()
    )
    this.renderer.el.addEventListener('dragover', (event) =>
      event.preventDefault()
    )
    this.renderer.el.addEventListener('drop', (event) => {
      event.preventDefault()
      const file = event.dataTransfer.files[0]
      if (file) this.importFile(file).catch(this.reportError)
    })
  }
  this.start = () => {
    this.renderer.resize()
    this.update()
    this.ready = this.restore()
    this.pwa = new PWAController(this)
    this.pwa.start().catch(this.reportError)
    document.body.classList.add('ready')
    return this.ready
  }
  this.restore = async () => {
    this.editFrozen = true
    try {
      await this.library.open()
      const projects = await this.library.list()
      let last
      try {
        last = localStorage.getItem('dotgrid:last-project')
      } catch (error) {
        /* Optional last-project preference. */
      }
      if (projects.length) {
        const record = await this.library.load(
          (projects.find((project) => project.id === last) || projects[0]).id
        )
        this.activate(record)
      } else {
        const record = await this.library.create(
          this.projectName,
          this.document.snapshot()
        )
        this.activate(record)
      }
    } catch (error) {
      this.saveState = 'Temporary / not saved'
      this.notice(error.message)
      this.savedDocumentRevision = -1
    } finally {
      this.editFrozen = false
      this.update()
    }
  }
  this.activate = (record) => {
    projectGeneration++
    clearTimeout(saveTimer)
    this.interface.resetDrafts()
    this.record = record
    this.projectName = record.name
    this.conflict = false
    this.recoveryPending = !!record.recovered
    this.tool.clear()
    this.tool.index = 0
    this.document.reset(record.payload)
    this.savedDocumentRevision = record.recovered ? -1 : 0
    this.saveState = record.recovered ? 'Recovered · not saved' : 'Saved'
    try {
      localStorage.setItem('dotgrid:last-project', record.id)
    } catch (error) {
      /* Artwork remains in IndexedDB. */
    }
    this.viewport.fit(this.tool.settings.size)
    if (record.recovered)
      this.notice(
        'Recovered the previous good snapshot. Export a backup or explicitly save this recovery before leaving. The original record is retained.'
      )
    this.update()
  }
  this.saveDraft = () => {
    if (this._saving) return this._saving
    if (this.conflict || this.recoveryPending) return Promise.resolve(false)
    if (this.savedDocumentRevision === this.document.revision && this.record)
      return Promise.resolve(true)
    const revision = this.document.revision
    const payload = this.document.snapshot()
    const record = this.record
    const name = this.projectName
    const generation = projectGeneration
    this.saveState = 'Saving'
    this.update()
    this._saving = (async () => {
      try {
        await this.library.open()
        const saved = record
          ? await this.library.save(record.id, name, payload, record.revision)
          : await this.library.create(name, payload)
        if (generation !== projectGeneration) return false
        this.record = saved
        this.savedDocumentRevision = revision
        try {
          localStorage.setItem('dotgrid:last-project', saved.id)
        } catch (error) {
          /* Optional preference. */
        }
        this.saveState =
          this.document.revision === revision ? 'Saved' : 'Saving'
        return this.document.revision === revision
      } catch (error) {
        if (generation !== projectGeneration) return false
        this.conflict = error.code === 'CONFLICT' || error.code === 'NOT_FOUND'
        this.saveState = this.conflict ? 'Conflict' : 'Save failed'
        this.notice(error.message)
        return false
      } finally {
        this._saving = null
        this.update()
        if (
          this.saveState === 'Saving' &&
          this.savedDocumentRevision !== this.document.revision
        ) {
          clearTimeout(saveTimer)
          saveTimer = setTimeout(() => this.saveDraft(), 0)
        }
      }
    })()
    return this._saving
  }
  this.checkpoint = async () => {
    if (this.recoveryPending) {
      const result = await this.interface.dialog(
        'Save recovered artwork?',
        'The newest stored snapshot was unreadable. Save this recovered version explicitly, or stay and export it first.',
        [
          { id: 'save', label: 'Save recovery', primary: true },
          { id: 'stay', label: 'Stay' }
        ]
      )
      if (result.choice !== 'save') return false
      this.recoveryPending = false
    }
    if (this._saving) await this._saving
    if (this.conflict) return false
    return (
      (await this.saveDraft()) &&
      this.saveState === 'Saved' &&
      this.savedDocumentRevision === this.document.revision
    )
  }
  this.canLeave = async () => {
    const previousFreeze = this.editFrozen
    this.editFrozen = true
    this.input.cancelAll()
    try {
      if (!(await this.guardPending())) return false
      this.tool.cancel()
      if (await this.checkpoint()) return true
      const result = await this.interface.dialog(
        this.conflict
          ? 'Project changed in another editor'
          : 'Draft is not saved',
        'Keep this draft open unless a retry saves it or you explicitly choose to discard it. Exporting a backup returns you to this draft.',
        this.conflict
          ? [
              { id: 'copy', label: 'Save as copy', primary: true },
              { id: 'export', label: 'Export draft' },
              { id: 'discard', label: 'Discard draft', danger: true },
              { id: 'stay', label: 'Stay' }
            ]
          : [
              { id: 'retry', label: 'Retry', primary: true },
              { id: 'export', label: 'Export backup' },
              { id: 'discard', label: 'Discard draft', danger: true },
              { id: 'stay', label: 'Stay' }
            ]
      )
      if (result.choice === 'retry') return this.canLeave()
      if (result.choice === 'copy') {
        await this.saveAsCopy()
        return false
      }
      if (result.choice === 'export') {
        await this.showExport(true)
        return false
      }
      return result.choice === 'discard'
    } finally {
      this.editFrozen = previousFreeze
      this.update()
    }
  }
  this.projectTransition = async (action, checkpoint = true) => {
    if (this.editFrozen) return false
    this.editFrozen = true
    this.input.cancelAll()
    this.update()
    try {
      if (checkpoint && !(await this.canLeave())) return false
      return await action()
    } finally {
      this.editFrozen = false
      this.update()
    }
  }
  this.saveAsCopy = async () => {
    const previousFreeze = this.editFrozen
    this.editFrozen = true
    this.input.cancelAll()
    try {
      if (this._saving) await this._saving
      clearTimeout(saveTimer)
      const record = await this.library.create(
        this.projectName + ' copy',
        this.document.snapshot()
      )
      projectGeneration++
      clearTimeout(saveTimer)
      this.record = record
      this.projectName = record.name
      this.conflict = false
      this.recoveryPending = false
      this.savedDocumentRevision = this.document.revision
      this.saveState = 'Saved'
      try {
        localStorage.setItem('dotgrid:last-project', record.id)
      } catch (error) {}
      this.notice('Draft saved as a separate project.')
    } catch (error) {
      if (!this._saving && this.savedDocumentRevision !== this.document.revision)
        this.saveState = this.conflict ? 'Conflict' : 'Save failed'
      this.reportError(error)
    } finally {
      this.editFrozen = previousFreeze
      this.update()
    }
  }
  this.newProject = () => this.projectTransition(async () => {
    const result = await this.interface.dialog(
      'New drawing',
      'Choose a local project name.',
      [
        { id: 'new', label: 'Create', primary: true },
        { id: 'cancel', label: 'Cancel' }
      ],
      [{ id: 'name', label: 'Name', value: 'Untitled' }]
    )
    if (result.choice !== 'new') return
    const payload = GridDocument.empty()
    const name = ProjectLibrary.validateName(result.values.name)
    try {
      this.activate(await this.library.create(name, payload))
    } catch (error) {
      this.openTemporary(name, payload)
      this.reportError(error)
    }
  })
  this.openTemporary = (name, payload) => {
    projectGeneration++
    clearTimeout(saveTimer)
    this.interface.resetDrafts()
    this.record = null
    this.projectName = name
    this.conflict = false
    this.recoveryPending = false
    this.tool.clear()
    this.tool.index = 0
    this.document.reset(payload)
    this.savedDocumentRevision = -1
    this.saveState = 'Temporary / not saved'
    this.fit()
    this.update()
  }
  this.importPayload = (payload, file) => this.projectTransition(async () => {
    const name =
      ((file && file.name) || 'Imported').replace(/\.grid$/i, '') || 'Imported'
    try {
      this.activate(await this.library.create(name, payload))
    } catch (error) {
      this.openTemporary(name, payload)
      this.reportError(error)
    }
  })
  this.importFile = async (file) => {
    const payload = await this.source.read(file)
    if (payload) await this.importPayload(payload, file)
  }
  this.showProjects = async () => {
    if (this.editFrozen) return
    this.input.cancelAll()
    const dialog = document.createElement('dialog')
    dialog.className = 'sheet'
    const heading = document.createElement('h2')
    heading.textContent = 'Local projects'
    heading.id = 'projects-title'
    dialog.setAttribute('aria-labelledby', heading.id)
    dialog.append(heading)
    const intro = document.createElement('p')
    intro.textContent =
      'Saved in this browser’s storage. Safari and a Home Screen app may have separate libraries; export .grid to transfer or back up.'
    dialog.append(intro)
    const rows = document.createElement('div')
    dialog.append(rows)
    const controls = document.createElement('div')
    controls.className = 'dialog-actions'
    dialog.append(controls)
    const close = () => {
      dialog.close()
      dialog.remove()
    }
    const button = (label, action, host = controls) => {
      const el = document.createElement('button')
      el.textContent = label
      el.addEventListener('click', () => {
        close()
        Promise.resolve(action()).catch(this.reportError)
      })
      host.append(el)
      return el
    }
    button('New', this.newProject)
    button('Import .grid', () =>
      this.source.choose((payload, file) => this.importPayload(payload, file))
    )
    button(this.conflict ? 'Save as copy' : 'Retry save', () =>
      this.conflict ? this.saveAsCopy() : this.checkpoint()
    )
    if (this.conflict && this.record)
      button('Load saved version', () => this.projectTransition(async () => {
        if (
          await this.interface.confirm(
            'Discard local draft?',
            'Load the saved version and discard your local unsaved changes. Export or save a copy first if needed.'
          )
        ) {
          if (this._saving) await this._saving
          this.activate(await this.library.load(this.record.id))
        }
      }, false))
    button('Export backup', () => this.showExport())
    button('Done', () => {})
    try {
      const projects = await this.library.list()
      if (!projects.length) {
        const empty = document.createElement('p')
        empty.textContent = 'No saved projects yet.'
        rows.append(empty)
      }
      for (const project of projects) {
        const row = document.createElement('div')
        row.className = 'project-row'
        rows.append(row)
        button(
          project.name,
          () => this.projectTransition(async () => {
            if (project.id === this.record?.id && !this.conflict) return
            this.activate(await this.library.load(project.id))
          }),
          row
        ).className = 'project-open'
        button(
          'Rename',
          () => this.projectTransition(async () => {
            const result = await this.interface.dialog(
              'Rename project',
              '',
              [
                { id: 'rename', label: 'Rename', primary: true },
                { id: 'cancel', label: 'Cancel' }
              ],
              [{ id: 'name', label: 'Name', value: project.name }]
            )
            if (result.choice !== 'rename') return
            const expectedRevision =
              this.record?.id === project.id
                ? this.record.revision
                : project.revision
            const record = await this.library.rename(
              project.id,
              result.values.name,
              expectedRevision
            )
            if (this.record?.id === project.id) {
              this.record = record
              this.projectName = record.name
              this.update()
            }
          }),
          row
        )
        button(
          'Duplicate',
          () => this.projectTransition(async () => {
            await this.library.duplicate(project.id)
            this.notice(
              'Saved project duplicated. Open it from Local projects.'
            )
          }, this.record?.id === project.id),
          row
        )
        button(
          'Delete',
          () => this.projectTransition(async () => {
            if (
              !(await this.interface.confirm(
                'Delete ' + project.name + '?',
                'This permanently deletes the local project and its recovery snapshot. Export a .grid backup first.'
              ))
            )
              return
            const expectedRevision =
              this.record?.id === project.id
                ? this.record.revision
                : project.revision
            await this.library.delete(project.id, expectedRevision)
            if (this.record?.id === project.id)
              this.openTemporary('Untitled', GridDocument.empty())
            this.notice('Local project deleted.')
          }),
          row
        ).className = 'danger'
      }
    } catch (error) {
      const failure = document.createElement('p')
      failure.textContent = error.message
      rows.append(failure)
    }
    dialog.addEventListener('cancel', () => {
      dialog.remove()
    })
    document.body.append(dialog)
    dialog.showModal()
    controls.lastElementChild.focus()
  }
  this.showExport = async (backupOnly = false) => {
    if (!(await this.guardPending())) return
    this.tool.cancel()
    const dialog = document.createElement('dialog')
    dialog.className = 'sheet'
    const heading = document.createElement('h2')
    heading.textContent = 'Export drawing'
    heading.id = 'export-title'
    dialog.setAttribute('aria-labelledby', heading.id)
    dialog.append(heading)
    const info = document.createElement('p')
    info.textContent =
      'Prepare the file, then use a fresh Share or Download tap. PNG is transparent at 2× document size. .grid keeps editable artwork.'
    dialog.append(info)
    const ready = document.createElement('p')
    ready.className = 'export-ready'
    ready.textContent = 'Choose a format.'
    dialog.append(ready)
    const controls = document.createElement('div')
    controls.className = 'dialog-actions'
    dialog.append(controls)
    let prepared = null
    let preparing = false
    const button = (label, action) => {
      const el = document.createElement('button')
      el.textContent = label
      el.addEventListener('click', () =>
        Promise.resolve(action()).catch((error) => {
          ready.textContent = error.message
          this.reportError(error)
        })
      )
      controls.append(el)
      return el
    }
    const prepare = async (format, scale = 2) => {
      if (preparing) return
      preparing = true
      prepared = null
      share.disabled = true
      download.disabled = true
      ready.textContent = 'Preparing…'
      try {
        prepared = await this.manager.prepare(format, { scale })
        ready.textContent = `Prepared ${prepared.name} · ${Math.ceil(prepared.size / 1024)} KB`
        share.disabled = !this.source.canShare(prepared)
        download.disabled = false
      } catch (error) {
        if (error.code === 'RASTER_LIMIT') {
          const size = this.tool.settings.size
          const lower = Math.min(
            1,
            Math.sqrt(16777216 / (size.width * size.height)) * 0.99
          )
          ready.textContent =
            '2× PNG exceeds the provisional memory budget. Choose Lower-resolution PNG, SVG, or .grid.'
          lowerButton.hidden = false
          lowerButton.onclick = () => prepare('png', lower)
        } else ready.textContent = error.message
      } finally {
        preparing = false
      }
    }
    button('Prepare .grid', () => prepare('grid'))
    if (!backupOnly) {
      button('Prepare SVG', () => prepare('svg'))
      button('Prepare PNG', () => prepare('png'))
    }
    const lowerButton = button('Lower-resolution PNG', () => {})
    lowerButton.hidden = true
    const share = button('Share', async () => {
      if (prepared) {
        const shared = await this.source.share(prepared)
        ready.textContent = shared
          ? 'Shared. Keep a .grid backup for editable artwork.'
          : 'Share cancelled. The prepared file is still available.'
      }
    })
    share.disabled = true
    const download = button('Download', () => {
      if (prepared) this.source.download(prepared)
    })
    download.disabled = true
    button('Done', () => {
      dialog.close()
      dialog.remove()
    })
    dialog.addEventListener('cancel', () => dialog.remove())
    document.body.append(dialog)
    dialog.showModal()
  }
  this.showDiagnostics = async () => {
    const metrics = this.renderer.metrics
    const sorted = metrics.samples.slice().sort((a, b) => a - b)
    const data = {
      release:
        typeof DOTGRID_RELEASE !== 'undefined'
          ? DOTGRID_RELEASE
          : 'development',
      projectSchema: 1,
      dimensions: this.tool.settings.size,
      segments: this.tool.length(),
      viewport: {
        scale: this.viewport.scale,
        width: this.viewport.width,
        height: this.viewport.height
      },
      frames: metrics.frames,
      pathBuilds: metrics.pathBuilds,
      renderWorkP95Ms: sorted.length
        ? Number(sorted[Math.floor((sorted.length - 1) * 0.95)].toFixed(2))
        : null,
      frameGapsOver33Ms: metrics.frameGaps.filter((gap) => gap > 33).length,
      longTasksOver50Ms: metrics.longTasks,
      backingPixels: metrics.backingPixels,
      persistence: this.library.persistence,
      saveState: this.saveState,
      offline: this.pwa.status,
      userAgent: navigator.userAgent,
      hardwareAcceptance: 'Pending physical iPad/Pencil verification'
    }
    await this.interface.dialog('Diagnostics', JSON.stringify(data, null, 2), [
      { id: 'done', label: 'Done' }
    ])
  }
  this.keyDown = (event) => {
    if (formTarget(event.target) || this.editFrozen) return
    const command = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    const actions = command
      ? {
          z: () =>
            this.contextChange(() => {
              this.tool.clear()
              event.shiftKey ? this.document.redo() : this.document.undo()
            }),
          y: () =>
            this.contextChange(() => {
              this.tool.clear()
              this.document.redo()
            }),
          s: () => this.showExport(),
          o: () =>
            this.source.choose((payload, file) =>
              this.importPayload(payload, file)
            ),
          n: this.newProject,
          e: () => this.showExport(),
          m: () => this.contextChange(() => this.tool.merge()),
          1: () =>
            this.contextChange(() => {
              this.tool.clear()
              this.tool.index = 0
            }),
          2: () =>
            this.contextChange(() => {
              this.tool.clear()
              this.tool.index = 1
            }),
          3: () =>
            this.contextChange(() => {
              this.tool.clear()
              this.tool.index = 2
            })
        }
      : {
          a: () => this.perform(() => this.tool.cast('line')),
          s: () => this.perform(() => this.tool.cast('arc_c')),
          d: () => this.perform(() => this.tool.cast('arc_r')),
          f: () => this.perform(() => this.tool.cast('bezier')),
          t: () => this.perform(() => this.tool.cast('arc_c_full')),
          y: () => this.perform(() => this.tool.cast('arc_r_full')),
          z: () => this.perform(() => this.tool.cast('close')),
          escape: () => this.perform(() => this.tool.clear()),
          backspace: () => this.perform(() => this.tool.removeLastPoint()),
          h: () => this.renderer.toggle(),
          0: this.fit
        }
    if (actions[key]) {
      event.preventDefault()
      Promise.resolve(actions[key]()).then(this.update).catch(this.reportError)
    }
  }
  this.clipboard = (type, event) => {
    if (
      formTarget(event.target) ||
      this.editFrozen ||
      this.tool.vertices.length
    )
      return
    this.input.cancelAll()
    this.tool.cancel()
    if (type === 'paste') {
      const text = event.clipboardData.getData('application/x-dotgrid-layer')
      if (!text) return
      try {
        const layer = JSON.parse(text)
        const payload = this.document.snapshot()
        payload.layers[this.tool.index] = layer
        const valid = ProjectLibrary.validate(payload)
        this.document.edit('Paste layer', (data) => {
          data.layers[this.tool.index].push(...valid.layers[this.tool.index])
        })
        event.preventDefault()
      } catch (error) {
        this.reportError(error)
      }
      return
    }
    event.clipboardData.setData(
      'application/x-dotgrid-layer',
      JSON.stringify(this.tool.layer())
    )
    event.clipboardData.setData('text/plain', this.tool.path())
    event.clipboardData.setData('image/svg+xml', this.manager.toString())
    event.preventDefault()
    if (type === 'cut')
      this.document.edit('Cut layer', (data) => {
        data.layers[this.tool.index] = []
      })
  }
}
