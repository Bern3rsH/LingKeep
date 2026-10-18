import { expect, test } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Importer } from '../src/main/imports'

test('EPUB2 NCX titles, inline styles and archived image retries work offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-epub-'))
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64')
    const bytes = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'),
      'OPS/book.opf': strToU8('<package><metadata/><manifest><item id="one" href="one.xhtml"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="one"/></spine></package>'),
      'OPS/toc.ncx': strToU8('<ncx><navMap><navPoint><navLabel><text>A chapter from NCX</text></navLabel><content src="one.xhtml"/></navPoint></navMap></ncx>'),
      'OPS/one.xhtml': strToU8('<html><body><p>Read <em>this</em>.</p><blockquote><p>A quote.</p></blockquote><img src="image.png" alt="Book illustration"/></body></html>'),
      'OPS/image.png': png
    })
    const importer = new Importer(directory)
    const material = await importer.epubBytes(bytes, 'fallback.epub', 'zh-en')
    const chapter = material.chapters[0]
    expect(material.title).toBe('fallback.epub'); expect(chapter.title).toBe('A chapter from NCX')
    expect(chapter.blocks[1].kind).toBe('quote')
    const image = chapter.blocks.find(block => block.image)!
    const asset = image.image!.asset!
    await rm(join(directory, asset)); image.image!.missing = true; delete image.image!.asset
    await importer.retryImage(image)
    expect(image.image!.missing).toBe(false)
    expect(await readFile(join(directory, image.image!.asset!))).toEqual(png)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
