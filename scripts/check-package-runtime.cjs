const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

async function main() {
  assert(process.argv[2], 'Expected packaged resources directory')
  const modules = join(resolve(process.argv[2]), 'app.asar', 'node_modules')
  const { createCanvas } = require(join(modules, '@napi-rs/canvas'))
  const pdfRoot = join(modules, 'pdfjs-dist')
  const { getDocument } = await import(pathToFileURL(join(pdfRoot, 'legacy/build/pdf.mjs')).href)
  for (const [fixture, expectedPages] of [['two-pages.pdf', 2], ['chinese.pdf', 1]]) {
    const data = Uint8Array.from(readFileSync(join(__dirname, '../tests/fixtures/pdf', fixture)))
    const task = getDocument({ data, useSystemFonts: true, useWorkerFetch: false,
      cMapUrl: join(pdfRoot, 'cmaps') + '/', cMapPacked: true,
      standardFontDataUrl: join(pdfRoot, 'standard_fonts') + '/', wasmUrl: join(pdfRoot, 'wasm') + '/' })
    try {
      const document = await task.promise
      assert.equal(document.numPages, expectedPages)
      const page = await document.getPage(1)
      const content = await page.getTextContent()
      assert(content.items.some(item => item.str), `${fixture} has no text`)
      const viewport = page.getViewport({ scale: 0.5 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvas: null, canvasContext: canvas.getContext('2d'), viewport }).promise
      assert((await canvas.encode('png')).length > 100)
    } finally { await task.destroy() }
  }
  console.log('PACKAGED_PDF_OK: packaged Electron/native canvas, English and Chinese PDF text extraction and cover rendering')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
