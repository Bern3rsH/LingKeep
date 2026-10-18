import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync, strToU8 } from 'fflate'
import { Importer } from '../src/main/imports'
import { Application } from '../src/main/application'
import { Store } from '../src/main/store'
import { Dictionaries } from '../src/main/dictionary'
import { AI } from '../src/main/ai'
import { makeSelection } from '../src/shared/reading'
import { materialSchema } from '../src/shared/domain'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true }))) })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/YQAAAAASUVORK5CYII=', 'base64')
function epub(metadata = '', items = '', resources: Record<string, Uint8Array> = {}, guide = '') {
  return zipSync({
    'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),
    'OPS/book.opf': strToU8(`<package xmlns:dc="urn:dc"><metadata><dc:title>Cover test</dc:title>${metadata}</metadata><manifest><item id="text" href="text.xhtml"/>${items}</manifest><spine><itemref idref="text"/></spine>${guide}</package>`),
    'OPS/text.xhtml': strToU8('<html><body><p>Read this book.</p></body></html>'),
    ...resources
  })
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ling-cover-test-')); directories.push(directory)
  return { directory, importer: new Importer(join(directory, 'assets')) }
}

test('EPUB 3 cover-image outside the spine is saved and retained by material validation', async () => {
  const { importer } = await fixture()
  const book = await importer.epubBytes(epub('', '<item id="art" href="Images/book%20cover.png" properties="cover-image"/>', { 'OPS/Images/book cover.png': png }), 'cover.epub', 'zh-en')
  expect(book.cover).toMatch(/^[a-f0-9]{64}\.png$/)
  expect(await readFile(join(importer.assetsDirectory, book.cover!))).toEqual(png)
  expect(materialSchema.parse(book).cover).toBe(book.cover)
  expect(book.chapters).toHaveLength(1)
  expect(book.chapters[0].blocks[0].text).toBe('Read this book.')
})
test('EPUB 2 meta cover IDs select the declared image, regardless of filename', async () => {
  const { importer } = await fixture()
  const book = await importer.epubBytes(epub('<meta name="cover" content="artwork"/>', '<item id="artwork" href="Images/artwork.jpg"/>', { 'OPS/Images/artwork.jpg': png }), 'cover.epub', 'zh-en')
  expect(book.cover).toMatch(/\.png$/)
  expect(await readFile(join(importer.assetsDirectory, book.cover!))).toEqual(png)
})
test.each([
  '<html><body><img src="../Images/artwork.png"/></body></html>',
  '<html xmlns:xlink="http://www.w3.org/1999/xlink"><body><svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="../Images/artwork.png"/></svg></body></html>'
])('guide cover pages resolve raster images inside XHTML or SVG wrappers', async page => {
  const { importer } = await fixture()
  const bytes = epub('', '', { 'OPS/Pages/front.xhtml': strToU8(page), 'OPS/Images/artwork.png': png }, '<guide><reference type="cover" href="Pages/front.xhtml#cover"/></guide>')
  const book = await importer.epubBytes(bytes, 'cover.epub', 'zh-en')
  expect(book.cover).toMatch(/\.png$/)
  expect(await readFile(join(importer.assetsDirectory, book.cover!))).toEqual(png)
})
test.each(['missing.png', 'bad.png', '../../outside.png', 'vector.svg'])('unavailable or unsupported cover %s does not discard text', async href => {
  const { importer } = await fixture()
  const book = await importer.epubBytes(epub('', `<item id="art" href="${href}" properties="cover-image"/>`, { 'OPS/bad.png': strToU8('not an image'), 'OPS/vector.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>') }), 'cover.epub', 'zh-en')
  expect(book.cover).toBeUndefined()
  expect(book.chapters[0].blocks[0].text).toBe('Read this book.')
})
test('old materials without covers remain valid; cover URLs cannot escape local assets', async () => {
  const { importer } = await fixture()
  const book = await importer.epubBytes(epub(), 'cover.epub', 'zh-en')
  expect(materialSchema.parse(book).cover).toBeUndefined()
  expect(materialSchema.safeParse({ ...book, cover: '../secret.png' }).success).toBe(false)
  expect(materialSchema.safeParse({ ...book, cover: 'https://example.com/cover.png' }).success).toBe(false)
})
test('first snapshot restores an existing EPUB cover once without changing learning data', async () => {
  const { directory, importer } = await fixture()
  const store = new Store(join(directory, 'state.json'))
  const app = new Application(store, importer, new Dictionaries('resources/dictionaries'), new AI(), async () => undefined, async () => undefined)
  const book = await importer.epubBytes(epub('<meta name="cover" content="art"/>', '<item id="art" href="image.png"/>', { 'OPS/image.png': png }), 'existing.epub', 'zh-en')
  const cover = book.cover!
  delete book.cover
  await rm(join(importer.assetsDirectory, cover))
  await app.learning.profile('zh-en'); await app.learning.addMaterial('zh-en', book)
  const selection = makeSelection(book.id, book.chapters[0], [{ start: 0, end: 4 }])
  await app.learning.status('zh-en', selection, 4, { text: '阅读', source: 'manual' })
  const keep = (await store.read()).profiles['zh-en'].keeps[0]
  await app.learning.editKeep('zh-en', keep.id, { note: 'My note' })
  const before = await store.read()
  const restore = vi.spyOn(importer, 'restoreCover')
  const results = await Promise.all([app.command({ type: 'snapshot' }), app.command({ type: 'snapshot' })])
  expect(results[0].snapshot?.profile?.materials[0].cover).toBe(cover)
  expect(restore).toHaveBeenCalledTimes(1)
  const after = await new Store(store.path).read()
  expect(after).toEqual({ ...before, profiles: { ...before.profiles, 'zh-en': { ...before.profiles['zh-en'], materials: [{ ...book, cover }] } } })
  expect(await readFile(join(importer.assetsDirectory, cover))).toEqual(png)
  await writeFile(join(importer.assetsDirectory, `${book.fingerprint}.epub`), 'broken archive')
  delete book.cover
  expect(await importer.restoreCover(book)).toBeUndefined()
})
