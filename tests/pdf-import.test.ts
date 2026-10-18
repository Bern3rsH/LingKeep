import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Importer } from '../src/main/imports'
import { importPDF, MAX_PDF_BYTES, pdfPageText } from '../src/main/pdf'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

const directories: string[] = []
async function fixture() { const directory = await mkdtemp(join(tmpdir(), 'ling-pdf-')); directories.push(directory); return new Importer(directory) }
const file = (name: string) => join(import.meta.dirname, 'fixtures/pdf', `${name}.pdf`)
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); vi.restoreAllMocks() })

test('real PDF pages extract selectable English text, metadata title, local cover and stable fingerprints', async () => {
  const importer = await fixture()
  const material = await importer.pdf(file('two-pages'), 'zh-en')
  expect(material.kind).toBe('pdf')
  expect(material.title).toBe('Reading PDF fixture')
  expect(material.source).toBe('two-pages.pdf')
  expect(material.chapters.map(chapter => chapter.title)).toEqual(['Page 1', 'Page 2'])
  expect(material.chapters.every(chapter => chapter.segmentation === 'ready')).toBe(true)
  expect(material.chapters[0].blocks.map(block => block.text).join('\n')).toContain('The bank is near the river.')
  expect(material.chapters[1].blocks[0].text).toBe('Second page has selectable words.')
  expect(material.cover).toMatch(/^[a-f0-9]{64}\.png$/)
  const cover = await readFile(join(importer.assetsDirectory, material.cover!))
  expect(cover.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const again = await importer.pdf(file('two-pages'), 'zh-en')
  expect(again.fingerprint).toBe(material.fingerprint)
  expect(again.id).not.toBe(material.id)
})
test('real Chinese PDF text remains Unicode and waits for segmentation', async () => {
  const importer = await fixture()
  const material = await importer.pdf(file('chinese'), 'en-zh')
  expect(material.chapters[0].segmentation).toBe('pending')
  expect(material.chapters[0].blocks.map(block => block.text).join('\n')).toBe('我们在河边学习中文。\n阅读可以帮助学习语言。')
  expect(material.cover).toBeTruthy()
})
test('empty pages are skipped while original page numbers remain in chapter titles', async () => {
  const material = await (await fixture()).pdf(file('blank-first'), 'zh-en')
  expect(material.chapters.map(chapter => chapter.title)).toEqual(['Page 2'])
  expect(material.chapters[0].blocks[0].text).toBe('Readable text after a blank page.')
})
test.each([['scanned', '扫描件请先进行 OCR'], ['encrypted', '暂不支持加密 PDF']] as const)('rejects real %s PDF with an actionable error', async (name, message) => {
  await expect((await fixture()).pdf(file(name), 'zh-en')).rejects.toThrow(message)
})
test('corrupt and oversized PDF files are rejected before extraction', async () => {
  const importer = await fixture()
  await expect(importer.pdfBytes(new Uint8Array([1, 2]), 'bad.pdf', 'zh-en')).rejects.toThrow('PDF 已损坏')
  await expect(importer.pdfBytes(Buffer.from('%PDF-1.7\nbroken'), 'bad.pdf', 'zh-en')).rejects.toThrow('PDF 已损坏')
  const oversized = join(importer.assetsDirectory, 'large.pdf')
  const handle = await open(oversized, 'w'); await handle.truncate(MAX_PDF_BYTES + 1); await handle.close()
  await expect(importer.pdf(oversized, 'zh-en')).rejects.toThrow('80 MB')
})
test('cover storage failure retains extracted text', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const material = await importPDF(await readFile(file('two-pages')), 'fixture.pdf', 'zh-en', async () => { throw new Error('disk full') })
  expect(material.chapters).toHaveLength(2)
  expect(material.cover).toBeUndefined()
  expect(warning).toHaveBeenCalledWith('[LingKeep] PDF cover generation failed')
})
test('text geometry preserves word gaps, line breaks and paragraph separation without adding spaces inside Chinese words', () => {
  const item = (str: string, x: number, y: number, width: number): TextItem => ({ str, width, height: 10, transform: [10, 0, 0, 10, x, y], dir: 'ltr', hasEOL: false, fontName: 'test' })
  expect(pdfPageText([item('Hello', 0, 100, 25), item('world', 30, 100, 25), item('Next line', 0, 88, 40), item('Paragraph', 0, 60, 40)])).toBe('Hello world\nNext line\n\nParagraph')
  expect(pdfPageText([item('学', 0, 100, 10), item('习', 10, 100, 10)])).toBe('学习')
})
