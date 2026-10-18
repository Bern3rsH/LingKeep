// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { Library } from '../src/renderer/src/Library'
import { I18nProvider, useI18n } from '../src/renderer/src/i18n'
import type { InterfaceLanguage, Material } from '../src/shared/domain'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
const open = vi.fn()
const book: Material = { id: 'book', title: 'Book', kind: 'epub', source: 'book.epub', fingerprint: 'test', createdAt: '', chapters: Array.from({ length: 43 }, (_, index) => ({ id: `part-${index}`, title: `Title ${index}`, segmentation: 'ready', blocks: [] })) }
function Language({ language }: { language: InterfaceLanguage }) {
  const { setLanguage } = useI18n()
  useEffect(() => setLanguage(language), [language, setLanguage])
  return null
}
async function render(material: Material, language: InterfaceLanguage = 'zh') {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<I18nProvider><Language language={language} /><Library profileId="zh-en" materials={[material]} apply={() => {}} open={open} report={() => {}} /></I18nProvider>))
}
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.replaceChildren(); open.mockClear() })

test.each([1, 8, 43])('EPUB progress shows the title of chapter %i and a separate total using saved chapter IDs', async chapter => {
  const material = { ...book, progress: { chapterId: book.chapters[chapter - 1].id, blockId: 'block', offset: 0 } }
  await render(material)
  const progress = container.querySelector('.epub-progress')!
  expect([...progress.children].map(node => node.textContent)).toEqual([book.chapters[chapter - 1].title, '继续阅读', '共 43 章节'])
  await act(async () => container.querySelector<HTMLButtonElement>('.cover')!.click())
  expect(open).toHaveBeenCalledExactlyOnceWith(material)
})
test.each([undefined, { chapterId: 'deleted', blockId: 'block', offset: 0 }])('unstarted or unavailable progress does not display an invalid chapter number', async progress => {
  await render({ ...book, progress })
  expect([...container.querySelector('.epub-progress')!.children].map(node => node.textContent)).toEqual(['尚未开始', '共 43 章节'])
})
test('pending segmentation retains its status and chapter count', async () => {
  await render({ ...book, chapters: book.chapters.map(chapter => ({ ...chapter, segmentation: 'pending' })) })
  expect([...container.querySelector('.epub-progress')!.children].map(node => node.textContent)).toEqual(['待分词', '共 43 章节'])
})
test('EPUB status follows the interface language while the chapter title preserves original text', async () => {
  const chapters = book.chapters.map(chapter => chapter.id === 'part-7' ? { ...chapter, title: '第八章：新的开始' } : chapter)
  await render({ ...book, chapters, progress: { chapterId: 'part-7', blockId: 'block', offset: 0 } }, 'en')
  expect([...container.querySelector('.epub-progress')!.children].map(node => node.textContent)).toEqual(['第八章：新的开始', 'Continue reading', '43 chapters in total'])
})
test('text materials retain their current progress presentation', async () => {
  await render({ ...book, kind: 'text' })
  expect(container.querySelector('.epub-progress')).toBeNull()
  expect(container.querySelector('.card-detail p')?.textContent).toBe('43 章节 · 尚未开始')
})
test.each(['zh', 'en'] as const)('PDF cards show their page name, resume status and page total in %s', async language => {
  await render({ ...book, kind: 'pdf', progress: { chapterId: 'part-7', blockId: 'block', offset: 0 } }, language)
  expect([...container.querySelector('.epub-progress')!.children].map(node => node.textContent)).toEqual(['Title 7', language === 'zh' ? '继续阅读' : 'Continue reading', language === 'zh' ? '共 43 页' : '43 pages in total'])
  expect(container.querySelector('.cover>span')?.textContent).toBe('PDF')
})
