import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { unzipSync, strFromU8 } from 'fflate'
import { MAX_INPUT, targetLanguage, type Block, type Chapter, type Material, type ProfileId } from '../shared/domain'
import { download } from './network'

const MAX_EPUB_BYTES = 80 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 160 * 1024 * 1024
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
export const firstImageAsset = (material: Material): string | undefined => material.chapters.flatMap(chapter => chapter.blocks).find(block => block.image)?.image?.asset
function epubResources(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > MAX_EPUB_BYTES) throw new Error('EPUB 文件超过大小限制')
  let total = 0
  let files: Record<string, Uint8Array>
  try { files = unzipSync(bytes, { filter: entry => {
    total += entry.originalSize
    if (total > MAX_UNCOMPRESSED_BYTES || entry.originalSize > MAX_UNCOMPRESSED_BYTES) throw new Error('EPUB 解压内容超过限制')
    return true
  } }) } catch { throw new Error('EPUB 损坏或解压内容超过限制') }
  if (files['META-INF/encryption.xml']) throw new Error('暂不支持加密 EPUB')
  return files
}
function parseEPUBResource(files: Record<string, Uint8Array>, path: string): JSDOM {
  if (!files[path]) throw new Error(`EPUB 缺少章节或资源：${path}`)
  return new JSDOM(strFromU8(files[path]), { contentType: 'application/xhtml+xml' })
}
function resolveEPUBPath(base: string, path: string): string {
  const resolved = posix.normalize(posix.join(posix.dirname(base), decodeURIComponent(path.split('#')[0])))
  if (resolved.startsWith('../') || resolved.startsWith('/')) throw new Error('EPUB 包含无效资源路径')
  return resolved
}
export const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const fallbackTitle = (text: string) => text.split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 160) || '未命名材料'
function chapter(title: string, blocks: Block[], profile: ProfileId): Chapter {
  return { id: randomUUID(), title, blocks, segmentation: targetLanguage(profile) === 'zh' ? 'pending' : 'ready' }
}
function material(kind: Material['kind'], title: string, source: string, fingerprint: string, chapters: Chapter[]): Material {
  if (!chapters.some(chapter => chapter.blocks.some(block => block.text.trim()))) throw new Error('未提取到正文，请改用粘贴文本')
  return { id: randomUUID(), kind, title, source, fingerprint, chapters, createdAt: new Date().toISOString() }
}
export function importText(text: string, title: string, profile: ProfileId): Material {
  if (!text.trim()) throw new Error('请填写正文')
  if (text.length > MAX_INPUT) throw new Error('文本超过长度限制')
  const blocks: Block[] = text.split(/\n\s*\n/).filter(part => part.trim()).map(text => ({ id: randomUUID(), kind: 'paragraph', text, emphasis: [], tokens: [] }))
  return material('text', title.trim() || fallbackTitle(text), '', hash(text), [chapter('正文', blocks, profile)])
}

// Only text and explicitly supported structure enter the reader; imported HTML is never rendered.
export function htmlBlocks(document: Document, root: Element): Block[] {
  root.querySelectorAll('script,style,iframe,object,form,nav,footer,noscript').forEach(node => node.remove())
  const blocks: Block[] = []
  let current: Block | undefined
  const flush = () => { if (current && current.text.trim()) blocks.push(current); current = undefined }
  const append = (text: string) => {
    current ??= { id: randomUUID(), kind: 'paragraph', text: '', emphasis: [], tokens: [] }
    current.text += text
  }
  const walk = (node: Node) => {
    if (node.nodeType === 3) { append(node.textContent || ''); return }
    if (node.nodeType !== 1) return
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    if (tag === 'img') {
      flush()
      const source = element.getAttribute('src') || element.getAttribute('data-src') || ''
      const caption = element.closest('figure')?.querySelector('figcaption')?.textContent || element.getAttribute('alt') || ''
      blocks.push({ id: randomUUID(), kind: 'image', text: '', emphasis: [], tokens: [], image: { source, caption, missing: true } })
      return
    }
    if (tag === 'figcaption') return
    if (tag === 'br') { append('\n'); return }
    const structural = /^(p|div|section|article|h[1-6]|li|blockquote|figure|ul|ol|main)$/.test(tag)
    if (structural) {
      flush()
      current = { id: randomUUID(), kind: /^h[1-6]$/.test(tag) ? 'heading' : element.closest('li') ? 'list' : element.closest('blockquote') ? 'quote' : 'paragraph', text: '', emphasis: [], tokens: [] }
    }
    const start = current?.text.length || 0
    const owner = current
    for (const child of element.childNodes) walk(child)
    if (owner && current === owner && ['b', 'strong', 'i', 'em'].includes(tag)) {
      current.emphasis.push({ start, end: current.text.length, kind: ['b', 'strong'].includes(tag) ? 'bold' : 'italic' })
    }
    if (structural) flush()
  }
  walk(root); flush()
  return blocks
}

export class Importer {
  constructor(readonly assetsDirectory: string) {}
  async pdf(path: string, profile: ProfileId): Promise<Material> {
    const { MAX_PDF_BYTES } = await import('./pdf')
    if ((await stat(path)).size > MAX_PDF_BYTES) throw new Error('PDF 文件超过 80 MB 限制')
    return this.pdfBytes(await readFile(path), basename(path), profile)
  }
  async pdfBytes(bytes: Uint8Array, fileName: string, profile: ProfileId): Promise<Material> {
    const { importPDF } = await import('./pdf')
    return importPDF(bytes, fileName, profile, bytes => this.saveImage(bytes))
  }
  private async extractCover(files: Record<string, Uint8Array>, packagePath: string, document: Document): Promise<string | undefined> {
    const items = [...document.querySelectorAll('manifest > item')]
    const candidates = new Set<string>()
    const add = (href: string | null) => { if (href) try { candidates.add(resolveEPUBPath(packagePath, href)) } catch { /* Invalid optional cover must not discard the book. */ } }
    for (const item of items) if (item.getAttribute('properties')?.split(/\s+/).includes('cover-image')) add(item.getAttribute('href'))
    const coverId = document.querySelector('metadata > meta[name="cover"]')?.getAttribute('content')
    if (coverId) add(items.find(item => item.getAttribute('id') === coverId)?.getAttribute('href') || null)
    for (const reference of document.querySelectorAll('guide > reference')) if (reference.getAttribute('type')?.split(/\s+/).includes('cover')) add(reference.getAttribute('href'))
    for (const item of items) if (item.getAttribute('id')?.toLowerCase() === 'cover' || /(?:^|\/)cover\.(?:png|jpe?g|gif|webp|xhtml|html|svg)$/i.test(item.getAttribute('href') || '')) add(item.getAttribute('href'))
    for (const path of candidates) {
      if (!files[path]) continue
      let images = [path]
      if (/\.(?:xhtml|html|svg)$/i.test(path)) {
        let dom: JSDOM | undefined
        try {
          dom = parseEPUBResource(files, path)
          images = [...dom.window.document.querySelectorAll('img, image')].flatMap(image => {
            const source = image.getAttribute('src') || image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
            if (!source) return []
            try { return [resolveEPUBPath(path, source)] } catch { return [] }
          })
        } catch { continue } finally { dom?.window.close() }
      }
      for (const image of images) if (files[image]) {
        try { return await this.saveImage(files[image]) } catch { /* Unsupported or damaged covers fall back to the title card. */ }
      }
    }
    return undefined
  }
  async restoreCover(material: Material): Promise<string | undefined> {
    if (material.kind !== 'epub' || material.cover || !/^[a-f0-9]{64}$/.test(material.fingerprint)) return material.cover
    let packageDOM: JSDOM | undefined
    try {
      const files = epubResources(await readFile(join(this.assetsDirectory, `${material.fingerprint}.epub`)))
      const container = parseEPUBResource(files, 'META-INF/container.xml')
      let packagePath: string | null | undefined
      try { packagePath = container.window.document.querySelector('rootfile')?.getAttribute('full-path') } finally { container.window.close() }
      if (!packagePath) return undefined
      packageDOM = parseEPUBResource(files, packagePath)
      return await this.extractCover(files, packagePath, packageDOM.window.document)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[LingKeep] EPUB cover recovery skipped')
      return undefined
    } finally { packageDOM?.window.close() }
  }
  async saveImage(bytes: Uint8Array): Promise<string> {
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('图片超过大小限制')
    // Raster formats only; SVG and imported active content are excluded.
    const buffer = Buffer.from(bytes)
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    const gif = buffer.subarray(0, 3).toString() === 'GIF'
    const webp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
    if (!png && !jpeg && !gif && !webp) throw new Error('不支持的图片格式')
    const asset = `${hash(bytes)}.${png ? 'png' : jpeg ? 'jpg' : gif ? 'gif' : 'webp'}`
    await mkdir(this.assetsDirectory, { recursive: true })
    await writeFile(join(this.assetsDirectory, asset), bytes, { mode: 0o600 })
    return asset
  }
  async retryImage(block: Block): Promise<void> {
    if (!block.image) return
    try {
      let bytes: Uint8Array
      if (block.image.source.startsWith('epub:')) {
        const match = block.image.source.match(/^epub:([a-f0-9]{64})\/(.+)$/)
        if (!match) throw new Error('EPUB 图片来源无效')
        const archive = await readFile(join(this.assetsDirectory, `${match[1]}.epub`))
        const resources = unzipSync(archive, { filter: entry => entry.name === match[2] && entry.originalSize <= MAX_IMAGE_BYTES })
        bytes = resources[match[2]]
        if (!bytes) throw new Error('EPUB 内缺少图片')
      } else bytes = (await download(block.image.source, MAX_IMAGE_BYTES)).bytes
      block.image.asset = await this.saveImage(bytes)
      block.image.missing = false
    } catch { block.image.missing = true }
  }
  async web(url: string, title: string, profile: ProfileId): Promise<Material> {
    const normalized = new URL(url); normalized.hash = ''
    const { bytes, url: finalURL } = await download(normalized.href)
    const dom = new JSDOM(bytes.toString('utf8'), { url: finalURL })
    try {
      const article = new Readability(dom.window.document).parse()
      if (!article?.content) throw new Error('网页正文解析失败，请改用粘贴文本')
      const content = new JSDOM(article.content, { url: finalURL })
      try {
        const blocks = htmlBlocks(content.window.document, content.window.document.body)
        for (const block of blocks) if (block.image) {
          try { block.image.source = new URL(block.image.source, finalURL).href; await this.retryImage(block) }
          catch { block.image.missing = true }
        }
        const result = material('url', title.trim() || article.title?.trim() || fallbackTitle(article.textContent || ''), normalized.href, hash(normalized.href), [chapter('正文', blocks, profile)])
        result.cover = firstImageAsset(result)
        return result
      } finally { content.window.close() }
    } finally { dom.window.close() }
  }
  async epub(path: string, profile: ProfileId): Promise<Material> {
    const bytes = await readFile(path)
    return this.epubBytes(bytes, basename(path), profile)
  }
  async epubBytes(bytes: Uint8Array, fileName: string, profile: ProfileId): Promise<Material> {
    const archiveHash = hash(bytes)
    const files = epubResources(bytes)
    const parse = (path: string) => parseEPUBResource(files, path)
    const container = parse('META-INF/container.xml')
    const packagePath = container.window.document.querySelector('rootfile')?.getAttribute('full-path')
    container.window.close()
    if (!packagePath) throw new Error('EPUB 缺少书籍目录')
    const packageDOM = parse(packagePath)
    try {
      const document = packageDOM.window.document
      if (document.querySelector('meta[property="rendition:layout"]')?.textContent === 'pre-paginated') throw new Error('暂不支持固定版式 EPUB')
      const title = document.getElementsByTagName('dc:title')[0]?.textContent?.trim() || fileName
      const manifest = new Map([...document.querySelectorAll('manifest > item')].map(item => [item.getAttribute('id'), item]))
      const resolve = resolveEPUBPath
      const chapterNames = new Map<string, string>()
      const nav = [...manifest.values()].find(item => item.getAttribute('properties')?.includes('nav'))
      if (nav) {
        const navPath = resolve(packagePath, nav.getAttribute('href') || '')
        const navDOM = parse(navPath)
        const navigation = [...navDOM.window.document.querySelectorAll('nav')].find(node => node.getAttribute('epub:type')?.split(' ').includes('toc')) || navDOM.window.document.querySelector('nav')
        for (const link of navigation?.querySelectorAll('a[href]') || []) {
          const path = resolve(navPath, link.getAttribute('href')!)
          if (!chapterNames.has(path)) chapterNames.set(path, link.textContent?.trim() || '')
        }
        navDOM.window.close()
      } else {
        const ncx = manifest.get(document.querySelector('spine')?.getAttribute('toc') || '') || [...manifest.values()].find(item => item.getAttribute('media-type') === 'application/x-dtbncx+xml')
        if (ncx) {
          const ncxPath = resolve(packagePath, ncx.getAttribute('href') || '')
          const ncxDOM = parse(ncxPath)
          for (const content of ncxDOM.window.document.querySelectorAll('navPoint > content[src]')) {
            const path = resolve(ncxPath, content.getAttribute('src')!)
            if (!chapterNames.has(path)) chapterNames.set(path, content.parentElement?.querySelector('navLabel > text')?.textContent?.trim() || '')
          }
          ncxDOM.window.close()
        }
      }
      const chapters: Chapter[] = []
      for (const reference of document.querySelectorAll('spine > itemref')) {
        if (reference.getAttribute('properties')?.includes('rendition:layout-pre-paginated')) throw new Error('暂不支持固定版式 EPUB')
        const item = manifest.get(reference.getAttribute('idref'))
        if (!item) throw new Error('EPUB 章节目录不完整')
        const path = resolve(packagePath, item.getAttribute('href') || '')
        const dom = parse(path)
        try {
          const root = dom.window.document.querySelector('body')
          if (!root) continue
          const blocks = htmlBlocks(dom.window.document, root)
          for (const block of blocks) if (block.image) {
            const resourcePath = resolve(path, block.image.source)
            block.image.source = `epub:${archiveHash}/${resourcePath}`
            if (files[resourcePath]) try { block.image.asset = await this.saveImage(files[resourcePath]); block.image.missing = false } catch { /* Missing image does not discard text. */ }
          }
          chapters.push(chapter(chapterNames.get(path) || root.querySelector('h1,h2,h3')?.textContent?.trim() || `章节 ${chapters.length + 1}`, blocks, profile))
        } finally { dom.window.close() }
      }
      const result = material('epub', title, fileName, archiveHash, chapters)
      result.cover = await this.extractCover(files, packagePath, document)
      await mkdir(this.assetsDirectory, { recursive: true })
      await writeFile(join(this.assetsDirectory, `${archiveHash}.epub`), bytes, { mode: 0o600 })
      return result
    } finally { packageDOM.window.close() }
  }
}
