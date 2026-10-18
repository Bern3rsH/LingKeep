import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import asar from '@electron/asar'

const directory = process.argv[2]
assert(directory, 'Usage: npm run check:package -- <packaged resources directory>')
const archive = join(directory, 'app.asar')
const extractFile = relativePath => asar.extractFile(archive, join(...relativePath.split('/')))
const paths = asar.listPackage(archive).map(path => path.replaceAll('\\', '/').replace(/^\//, ''))
for (const path of ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html',
  'node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  'resources/dictionaries/ECDICT-LICENSE.txt', 'resources/dictionaries/CC-CEDICT-NOTICE.txt']) {
  assert(paths.includes(path), `Missing packaged file: ${path}`)
}
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  assert(paths.some(path => path.startsWith(`node_modules/pdfjs-dist/${folder}/`)), `Missing PDF ${folder}`)
}
const manifest = JSON.parse(extractFile('resources/dictionaries/manifest.json'))
for (const [name, entry] of Object.entries(manifest.dictionaries)) {
  const bytes = extractFile(`resources/dictionaries/${name}.json.gz`)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${name} checksum mismatch`)
  assert(entry.entries > 50_000, `${name} dictionary is incomplete`)
}
async function nativeFiles(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await nativeFiles(path))
    else if (entry.name.endsWith('.node')) result.push(path)
  }
  return result
}
const binaries = await nativeFiles(join(directory, 'app.asar.unpacked', 'node_modules', '@napi-rs'))
assert(binaries.length > 0, 'Missing unpacked native PDF canvas module')
for (const path of binaries) assert((await stat(path)).size > 0, `Empty native module: ${path}`)
const metadata = JSON.parse(extractFile('package.json'))
const source = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
assert.equal(metadata.version, source.version)
assert(!paths.some(path => /(^|\/)(state\.json|\.env|\.cache)(\/|$)/.test(path)), 'Local data included in package')
console.log(`PACKAGE_OK: v${metadata.version}, dictionaries/checksums/licenses, PDF worker/fonts/wasm and native canvas`)
