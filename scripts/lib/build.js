'use strict'

// This is the legacy build entry point, never a window runtime source.
const { build, cliOptions } = require('../../tools/build-pwa.js')
const artifact = build(cliOptions(process.argv.slice(2)))
console.log(`Built Dotgrid iPad release ${artifact.release}`)
