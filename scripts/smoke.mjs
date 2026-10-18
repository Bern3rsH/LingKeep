import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electron from 'electron'

const directory = await mkdtemp(join(tmpdir(), 'ling-keep-smoke-'))
const env = { ...process.env, LING_KEEP_SMOKE: '1', LING_KEEP_DATA_DIR: directory }
delete env.ELECTRON_RUN_AS_NODE
const processHandle = spawn(electron, ['.'], { cwd: new URL('..', import.meta.url), env, stdio: 'inherit' })
const timeout = setTimeout(() => processHandle.kill(), 90_000)
processHandle.once('exit', code => { clearTimeout(timeout); console.log(`Smoke artifacts: ${directory}`); process.exitCode = code ?? 1 })
