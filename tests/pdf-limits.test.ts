import { afterEach, expect, test, vi } from 'vitest'
import { importPDF } from '../src/main/pdf'
import { MAX_INPUT } from '../src/shared/domain'

const engine = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn(async () => {}) }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: engine.getDocument }))
afterEach(() => { vi.clearAllMocks() })
const bytes = Buffer.from('%PDF-1.7\nfixture')

test('page limit rejects before loading pages and destroys the loading task', async () => {
  const getPage = vi.fn()
  engine.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1001, getPage }), destroy: engine.destroy })
  await expect(importPDF(bytes, 'large.pdf', 'zh-en', vi.fn())).rejects.toThrow('PDF 超过 1000 页限制')
  expect(getPage).not.toHaveBeenCalled()
  expect(engine.destroy).toHaveBeenCalledTimes(1)
})
test('text limit stops extraction before rendering a cover and destroys the loading task', async () => {
  const render = vi.fn()
  const page = { getTextContent: async () => ({ items: [{ str: 'x'.repeat(MAX_INPUT + 1), hasEOL: false }] }), render }
  engine.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: async () => page }), destroy: engine.destroy })
  await expect(importPDF(bytes, 'long.pdf', 'zh-en', vi.fn())).rejects.toThrow('PDF 正文超过长度限制')
  expect(render).not.toHaveBeenCalled()
  expect(engine.destroy).toHaveBeenCalledTimes(1)
})
