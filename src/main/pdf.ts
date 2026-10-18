import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { MAX_INPUT, targetLanguage, type Block, type Material, type ProfileId } from '../shared/domain'

export const MAX_PDF_BYTES = 80 * 1024 * 1024
const MAX_PDF_PAGES = 1000
const COVER_MAX_DIMENSION = 1000
const MAX_IMAGE_PIXELS = 8_000_000
const LINE_DISTANCE_RATIO = 0.5
const PARAGRAPH_DISTANCE_RATIO = 1.6
const WORD_GAP_RATIO = 0.1

export function pdfPageText(items: TextItem[]): string {
  let text = '', previous: TextItem | undefined
  for (const item of items) {
    if (!item.str) { if (item.hasEOL && text && !text.endsWith('\n')) text += '\n'; continue }
    if (previous) {
      const height = Math.max(Math.abs(previous.height), Math.abs(item.height), 1)
      const lineDistance = Math.abs(item.transform[5] - previous.transform[5])
      if (lineDistance > height * LINE_DISTANCE_RATIO) {
        const separator = lineDistance > height * PARAGRAPH_DISTANCE_RATIO ? '\n\n' : '\n'
        if (!text.endsWith(separator)) text = text.trimEnd() + separator
      } else if (!/\s$/.test(text) && !/^\s/.test(item.str) && item.transform[4] - (previous.transform[4] + previous.width) > height * WORD_GAP_RATIO) text += ' '
    }
    text += item.str
    if (item.hasEOL) text += '\n'
    previous = item
  }
  return text.trim()
}

export async function importPDF(bytes: Uint8Array, fileName: string, profile: ProfileId, saveImage: (bytes: Uint8Array) => Promise<string>): Promise<Material> {
  if (bytes.length > MAX_PDF_BYTES) throw new Error('PDF 文件超过 80 MB 限制')
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) throw new Error('PDF 已损坏或格式不受支持')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
  const resources = dirname(require.resolve('pdfjs-dist/package.json'))
  const task = getDocument({ data: Uint8Array.from(bytes), enableXfa: false, useSystemFonts: true, useWorkerFetch: false,
    cMapUrl: join(resources, 'cmaps') + '/', cMapPacked: true, standardFontDataUrl: join(resources, 'standard_fonts') + '/', wasmUrl: join(resources, 'wasm') + '/', maxImageSize: MAX_IMAGE_PIXELS })
  try {
    const document = await task.promise
    if (document.numPages > MAX_PDF_PAGES) throw new Error('PDF 超过 1000 页限制')
    const chapters: Material['chapters'] = []
    let length = 0
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index)
      const content = await page.getTextContent()
      const text = pdfPageText(content.items.filter((item): item is TextItem => 'str' in item))
      length += text.length
      if (length > MAX_INPUT) throw new Error('PDF 正文超过长度限制')
      if (text) {
        const blocks: Block[] = text.split(/\n\s*\n/).filter(part => part.trim()).map(text => ({ id: randomUUID(), kind: 'paragraph', text, emphasis: [], tokens: [] }))
        chapters.push({ id: randomUUID(), title: `Page ${index}`, blocks, segmentation: targetLanguage(profile) === 'zh' ? 'pending' : 'ready' })
      }
      page.cleanup()
    }
    if (!chapters.length) throw new Error('PDF 没有可提取的文字，扫描件请先进行 OCR')
    let title = basename(fileName).replace(/\.pdf$/i, '') || 'PDF'
    try {
      const metadata = await document.getMetadata()
      const candidate = (metadata.info as { Title?: unknown }).Title
      if (typeof candidate === 'string' && candidate.trim()) title = candidate.trim().slice(0, 300)
    } catch { /* Optional metadata must not discard extracted text. */ }
    const material: Material = { id: randomUUID(), kind: 'pdf', source: basename(fileName), title, fingerprint: createHash('sha256').update(bytes).digest('hex'), chapters, createdAt: new Date().toISOString() }
    try {
      const { createCanvas } = await import('@napi-rs/canvas')
      const page = await document.getPage(1)
      const original = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(1, COVER_MAX_DIMENSION / Math.max(original.width, original.height)) })
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)))
      await page.render({ canvas: null, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport }).promise
      material.cover = await saveImage(await canvas.encode('png'))
      page.cleanup()
    } catch { console.warn('[LingKeep] PDF cover generation failed') }
    return material
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('暂不支持加密 PDF，请解密后再导入')
    if (error instanceof Error && error.message.startsWith('PDF ')) throw error
    throw new Error('PDF 已损坏或格式不受支持')
  } finally { await task.destroy() }
}
