import { expect, test } from 'vitest'
import { JSDOM } from 'jsdom'
import { zipSync, strToU8 } from 'fflate'
import { htmlBlocks, importText, Importer } from '../src/main/imports'

test('text titles, empty rejection, independent IDs and stable duplicate fingerprint', () => {
  expect(() => importText(' \n', '', 'zh-en')).toThrow('正文')
  const a = importText('Hello\n\nWorld', '', 'zh-en')
  const b = importText('Hello\n\nWorld', 'Same', 'en-zh')
  expect(a.title).toBe('Hello'); expect(a.fingerprint).toBe(b.fingerprint); expect(a.id).not.toBe(b.id)
  expect(a.chapters[0].segmentation).toBe('ready'); expect(b.chapters[0].segmentation).toBe('pending')
})
test('extracts supported structure and formatting without active HTML', () => {
  const dom = new JSDOM('<article><h2>Title</h2><p>A <b>bold</b> word.</p><ul><li>Item</li></ul><figure><img src="a.png"><figcaption>Caption</figcaption></figure><script>bad()</script></article>')
  const blocks = htmlBlocks(dom.window.document, dom.window.document.body)
  expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'list', 'image'])
  expect(blocks[1].emphasis).toEqual([{ start: 2, end: 6, kind: 'bold' }])
  expect(blocks[3].image?.caption).toBe('Caption')
  expect(JSON.stringify(blocks)).not.toContain('bad()'); dom.window.close()
})
const epub = (extra: Record<string, Uint8Array> = {}) => zipSync({
  'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),
  'OPS/book.opf': strToU8('<package xmlns:dc="urn:dc"><metadata><dc:title>A book</dc:title></metadata><manifest><item id="one" href="one.xhtml"/></manifest><spine><itemref idref="one"/></spine></package>'),
  'OPS/one.xhtml': strToU8('<html><body><h1>One</h1><p>Read me.</p></body></html>'), ...extra
})
test('EPUB keeps spine chapters, detects corruption and encrypted/fixed layouts', async () => {
  const importer = new Importer('/private/tmp/ling-import-test-assets')
  const book = await importer.epubBytes(epub(), 'test.epub', 'zh-en')
  expect(book.title).toBe('A book'); expect(book.chapters[0].title).toBe('One')
  await expect(importer.epubBytes(new Uint8Array([1]), 'bad.epub', 'zh-en')).rejects.toThrow('损坏')
  await expect(importer.epubBytes(epub({ 'META-INF/encryption.xml': strToU8('<x/>') }), 'test.epub', 'zh-en')).rejects.toThrow('加密')
  await expect(importer.epubBytes(epub({ 'OPS/book.opf': strToU8('<package><metadata><meta property="rendition:layout">pre-paginated</meta></metadata></package>') }), 'test.epub', 'zh-en')).rejects.toThrow('固定版式')
})
