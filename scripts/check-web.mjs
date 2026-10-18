import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

await mkdir('.cache', { recursive: true })
await build({ entryPoints: ['src/main/imports.ts'], outfile: '.cache/import-check.mjs', platform: 'node', format: 'esm', bundle: true, packages: 'external' })
const { Importer } = await import('../.cache/import-check.mjs')
const directory = await mkdtemp(join(tmpdir(), 'ling-live-web-'))
try {
  const material = await new Importer(directory).web('https://example.com', '', 'zh-en')
  assert.equal(material.title, 'Example Domain')
  assert.ok(material.chapters[0].blocks.some(block => block.text.includes('documentation')))
  assert.equal(material.chapters[0].segmentation, 'ready')
  console.log('Live HTTPS download → article extraction → English reader readiness: passed')
} finally { await rm(directory, { recursive: true, force: true }) }
