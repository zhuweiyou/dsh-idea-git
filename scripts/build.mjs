import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))
const project = path.resolve(root, '..')

execFileSync(process.execPath, [path.join(project, 'scripts/build-host.mjs')], { stdio: 'inherit' })
execFileSync(process.execPath, [path.join(project, 'scripts/build-client.mjs')], { stdio: 'inherit' })
console.log('[build] done')
