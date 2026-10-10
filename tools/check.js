'use strict'
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { RUNTIME_FILES } = require('./build-pwa.js')
const files = RUNTIME_FILES.concat(fs.readdirSync(__dirname).filter(name => name.endsWith('.js')).map(name => 'tools/' + name), ['scripts/lib/build.js', 'playwright.config.js'])
for (const directory of ['tests/unit', 'tests/browser']) files.push(...fs.readdirSync(directory).filter(name => name.endsWith('.js')).map(name => path.join(directory, name)))
for (const file of new Set(files)) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file })
console.log('JavaScript syntax checked in runtime, build tools, and tests.')
