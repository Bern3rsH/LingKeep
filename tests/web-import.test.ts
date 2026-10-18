import { expect, test, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Importer } from '../src/main/imports'
import { download } from '../src/main/network'

vi.mock('../src/main/network', () => ({ download: vi.fn() }))
test('web article retains title/body and local image; failed image can be retried without moving text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-web-'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64')
  const html = `<html><head><title>Reading a river</title></head><body><nav>Navigation menu</nav><article><h1>Reading a river</h1><p>${'The river flows past the bank, and people read there. '.repeat(20)}</p><figure><img src="/river.png"><figcaption>A river</figcaption></figure><p>A final paragraph.</p></article><footer>Footer links</footer></body></html>`
  let imageFails = true
  vi.mocked(download).mockImplementation(async url => {
    if (url.endsWith('river.png')) { if (imageFails) throw new Error('offline'); return { bytes: png, url, contentType: 'image/png' } }
    return { bytes: Buffer.from(html), url, contentType: 'text/html' }
  })
  try {
    const importer = new Importer(directory)
    const material = await importer.web('https://example.com/article#heading', '', 'zh-en')
    const image = material.chapters[0].blocks.find(block => block.image)!
    expect(material.title).toBe('Reading a river'); expect(image.image?.missing).toBe(true)
    expect(material.cover).toBeUndefined()
    const before = material.chapters[0].blocks.map(block => [block.id, block.text])
    imageFails = false; await importer.retryImage(image)
    expect(image.image?.missing).toBe(false)
    expect(await readFile(join(directory, image.image!.asset!))).toEqual(png)
    expect(material.chapters[0].blocks.map(block => [block.id, block.text])).toEqual(before)
    expect(JSON.stringify(material.chapters)).not.toContain('Navigation menu')
    expect(material.source).toBe('https://example.com/article')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test.each([false, true])('web cover uses only the first parsed body image, first image fails=%s', async fails => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-web-cover-'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64')
  const html = `<html><head><title>Article</title><meta property="og:image" content="https://example.com/unrelated.png"></head><body><nav><img src="/logo.png"></nav><article><h1>Article</h1><p>${'Learning by reading long articles. '.repeat(30)}</p><img src="/first.png"><p>Middle paragraph.</p><img src="/second.png"><p>The final paragraph.</p></article></body></html>`
  vi.mocked(download).mockImplementation(async url => {
    if (url.endsWith('.png')) {
      if (fails && url.endsWith('/first.png')) throw new Error('offline')
      return { bytes: url.endsWith('/first.png') ? png : Buffer.concat([png, Buffer.from('second')]), url, contentType: 'image/png' }
    }
    return { bytes: Buffer.from(html), url, contentType: 'text/html' }
  })
  try {
    const material = await new Importer(directory).web('https://example.com/article', '', 'zh-en')
    const images = material.chapters[0].blocks.filter(block => block.image)
    expect(images.map(block => block.image!.source)).toEqual(['https://example.com/first.png', 'https://example.com/second.png'])
    expect(images[1].image?.asset).toBeTruthy()
    if (fails) expect(material.cover).toBeUndefined()
    else {
      expect(material.cover).toBe(images[0].image?.asset)
      expect(material.cover).not.toBe(images[1].image?.asset)
      expect(await readFile(join(directory, material.cover!))).toEqual(png)
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('web articles without images retain the default cover', async () => {
  const html = `<article><h1>Text only</h1><p>${'A text-only article for reading. '.repeat(30)}</p></article>`
  vi.mocked(download).mockResolvedValue({ bytes: Buffer.from(html), url: 'https://example.com/text', contentType: 'text/html' })
  const material = await new Importer('/private/tmp/ling-web-no-images').web('https://example.com/text', '', 'zh-en')
  expect(material.cover).toBeUndefined()
  expect(material.chapters[0].blocks.some(block => block.image)).toBe(false)
})
