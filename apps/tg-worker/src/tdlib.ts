import * as tdl from 'tdl'
import { getTdjson } from 'prebuilt-tdlib'
import { mkdirSync } from 'node:fs'
import { config } from './config.js'

let configured = false

export function createTdlibClient() {
  if (!configured) {
    tdl.configure({ tdjson: getTdjson() })
    configured = true
  }

  mkdirSync(config.paths.tdlibDb, { recursive: true })
  mkdirSync(config.paths.tdlibFiles, { recursive: true })

  return tdl.createClient({
    apiId: config.tg.apiId,
    apiHash: config.tg.apiHash,
    databaseDirectory: config.paths.tdlibDb,
    filesDirectory: config.paths.tdlibFiles,
    tdlibParameters: {
      application_version: '0.1.0',
      device_model: 'TeleCRM',
      system_language_code: 'en',
    },
  })
}
