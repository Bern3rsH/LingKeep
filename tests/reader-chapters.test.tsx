// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { Reader } from '../src/renderer/src/Reader'
import { emptyState, type Material, type ProfileId } from '../src/shared/domain'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const pagination = vi.hoisted(() => ({ page: 0, pageCount: 1, revision: 0, size: { width: 500, height: 300 }, locate: vi.fn(), showPage: vi.fn(), location: vi.fn(), refresh: vi.fn() }))
const voice = vi.hoisted(() => ({ play: vi.fn(async () => {}), stop: vi.fn() }))
vi.mock('../src/renderer/src/useReaderPagination', () => ({ READER_PAGE_PADDING: 32, useReaderPagination: () => pagination }))
vi.mock('../src/renderer/src/pronunciation', () => ({ pronunciation: voice }))
const invoke = vi.fn().mockResolvedValue({})
const onSelection = vi.fn()
const material: Material = { id: 'book', title: 'Book', kind: 'epub', source: '', fingerprint: 'book', createdAt: '', chapters: [0, 1, 2].map(index => ({ id: `chapter-${index}`, title: `Chapter ${index}`, segmentation: 'ready', blocks: [{ id: `block-${index}`, kind: 'paragraph', text: `Content ${index}`, emphasis: [], tokens: [] }] })) }
let root: Root | undefined
let container: HTMLDivElement
async function render(book = material, profileId: ProfileId = 'zh-en') {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  Object.assign(window, { ling: { invoke } })
  await act(async () => root!.render(<Reader profileId={profileId} profile={emptyState().profiles[profileId]} material={book} onSelection={onSelection} apply={() => {}} report={() => {}} back={() => {}} settings={() => {}} />))
}
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="章节"]')!
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); invoke.mockClear(); onSelection.mockClear(); voice.play.mockClear(); voice.stop.mockClear(); pagination.page = 0; pagination.pageCount = 1; pagination.revision = 0; pagination.location.mockReset(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function choose(id: string) {
  await act(async () => trigger().click())
  await act(async () => document.querySelector<HTMLElement>(`[role="option"][data-value="${id}"]`)!.click())
}

test('word lookup speaks exactly the selected text, replays repeated clicks and stops on chapter changes', async () => {
  await render()
  expect(voice.play).not.toHaveBeenCalled()
  const word = container.querySelector<HTMLSpanElement>('.word')!
  await act(async () => word.click())
  expect(voice.play).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Content', combined: false }), 'zh-en')
  await act(async () => word.click())
  expect(voice.play).toHaveBeenCalledTimes(2)
  await choose('chapter-1')
  expect(voice.stop).toHaveBeenCalled()
  const stopped = voice.stop.mock.calls.length
  await act(async () => root!.unmount()); root = undefined
  expect(voice.stop.mock.calls.length).toBe(stopped + 1)
})
test('combined lookup waits for completion and speaks only the selected spans', async () => {
  await render()
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '组合选词')!.click())
  const words = [...container.querySelectorAll<HTMLSpanElement>('.word')]
  await act(async () => { words[0].click(); words[1].click() })
  expect(voice.play).not.toHaveBeenCalled()
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.startsWith('完成'))!.click())
  expect(voice.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'Content … 0', combined: true }), 'zh-en')
})
test('drag lookup pronounces the expanded selection rather than the surrounding sentence', async () => {
  await render()
  const words = [...container.querySelectorAll<HTMLSpanElement>('.word')]
  const range = document.createRange()
  range.setStart(words[0].firstChild!, 1); range.setEnd(words[1].firstChild!, 1)
  const selection = window.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  await act(async () => container.querySelector('.reader-content')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  expect(voice.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'Content 0', combined: false }), 'zh-en')
  selection.removeAllRanges()
})

async function clickBlank(selector: string) {
  const blank = container.querySelector<HTMLElement>(selector)!
  await act(async () => {
    blank.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    blank.click()
  })
}
test.each(['.reader-content', '.reader-pages', '.reading-block', '.reader-page-stage', '.reader-pagination'])('clicking blank %s clears the current selection and restores the placeholder', async selector => {
  await render()
  await act(async () => container.querySelector<HTMLSpanElement>('.word')!.click())
  expect(container.querySelector('.meaning-sidebar.placeholder')).toBeNull()
  expect(container.querySelector('.word.current')).not.toBeNull()
  await clickBlank(selector)
  expect(onSelection).toHaveBeenLastCalledWith(undefined)
  expect(container.querySelector('.word.current, .reader-selection-frame')).toBeNull()
  expect(container.querySelector('.meaning-sidebar.placeholder')?.textContent).toContain('点击单词查看释义')
  expect(voice.stop).toHaveBeenCalledTimes(1)
  await act(async () => container.querySelector<HTMLSpanElement>('.word')!.click())
  expect(container.querySelector('.word.current')).not.toBeNull()
})
test('blank clicks clear native selection and pending combined fragments', async () => {
  await render()
  await act(async () => container.querySelector<HTMLSpanElement>('.word')!.click())
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '组合选词')!.click())
  await act(async () => container.querySelector<HTMLSpanElement>('.word')!.click())
  expect(container.querySelector('.fragment')).not.toBeNull()
  const word = container.querySelector('.word')!
  const native = window.getSelection()!
  const range = document.createRange(); range.selectNodeContents(word); native.addRange(range)
  await clickBlank('.reader-page-stage')
  expect(native.toString()).toBe('')
  expect(container.querySelector('.fragment, .current')).toBeNull()
  expect(container.querySelector('.meaning-sidebar.placeholder')).not.toBeNull()
  expect([...container.querySelectorAll('button')].find(button => button.textContent === '完成（0）')?.disabled).toBe(true)
})
test('the click ending a drag preserves selection, and a later blank click clears it', async () => {
  await render()
  const words = [...container.querySelectorAll<HTMLSpanElement>('.word')]
  const native = window.getSelection()!
  const range = document.createRange(); range.setStart(words[0].firstChild!, 1); range.setEnd(words[1].firstChild!, 1)
  native.removeAllRanges(); native.addRange(range)
  await act(async () => container.querySelector('.reader-content')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  await act(async () => container.querySelector<HTMLElement>('.reading-block')!.click())
  expect(container.querySelector('.word.current')).not.toBeNull()
  expect(container.querySelector('.meaning-sidebar.placeholder')).toBeNull()
  await clickBlank('.reader-page-stage')
  expect(container.querySelector('.word.current')).toBeNull()
  expect(native.toString()).toBe('')
})
test('side arrows and sidebar inputs preserve the selected word', async () => {
  pagination.pageCount = 3
  await render()
  await act(async () => container.querySelector<HTMLSpanElement>('.word')!.click())
  await act(async () => container.querySelector<HTMLTextAreaElement>('.meaning-input')!.click())
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click())
  expect(container.querySelector('.word.current')).not.toBeNull()
  expect(container.querySelector('.meaning-sidebar.placeholder')).toBeNull()
  expect(voice.stop).not.toHaveBeenCalled()
})
test('dictionary placeholder collapses to an accessible toggle and expands again', async () => {
  await render()
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="收起查词"]')!
  const content = container.querySelector<HTMLDivElement>('.lookup-panel-content')!
  expect(toggle.getAttribute('aria-controls')).toBe(content.id)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  await act(async () => toggle.click())
  expect(content.hidden).toBe(true)
  expect(toggle.getAttribute('aria-label')).toBe('展开查词')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('.lookup-panel.is-collapsed')).not.toBeNull()
  await act(async () => toggle.click())
  expect(content.hidden).toBe(false)
  expect(container.querySelector('.meaning-sidebar.placeholder')).not.toBeNull()
})
test('collapsing preserves lookup draft and selection without rerunning AI, and new words reopen it', async () => {
  await render()
  const words = [...container.querySelectorAll<HTMLSpanElement>('.word')]
  await act(async () => words[0].click())
  const input = container.querySelector<HTMLTextAreaElement>('.meaning-input')!
  const sidebar = container.querySelector('.meaning-sidebar')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'My draft meaning')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const requests = invoke.mock.calls.filter(([command]) => command.type === 'explain').length
  const toggle = container.querySelector<HTMLButtonElement>('.lookup-panel-toggle')!
  await act(async () => toggle.click())
  expect(container.querySelector<HTMLDivElement>('.lookup-panel-content')!.hidden).toBe(true)
  expect(container.querySelector('.word.current')).not.toBeNull()
  await act(async () => toggle.click())
  expect(container.querySelector('.meaning-sidebar')).toBe(sidebar)
  expect(container.querySelector('.meaning-input')).toBe(input)
  expect(input.value).toBe('My draft meaning')
  expect(invoke.mock.calls.filter(([command]) => command.type === 'explain')).toHaveLength(requests)
  expect(voice.play).toHaveBeenCalledTimes(1)
  await act(async () => toggle.click())
  await act(async () => words[1].click())
  expect(container.querySelector<HTMLDivElement>('.lookup-panel-content')!.hidden).toBe(false)
  expect(container.querySelector('.lookup-heading h2')?.textContent).toBe('0')
  expect(voice.play).toHaveBeenCalledTimes(2)
  expect(pagination.locate).toHaveBeenLastCalledWith('block-0', 8)
})

async function dragWords(first: number, last: number, reverse = false) {
  const words = [...container.querySelectorAll<HTMLSpanElement>('.word')]
  const viewport = container.querySelector('.reader-content')!
  await act(async () => viewport.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  const native = window.getSelection()!
  native.removeAllRanges()
  native.setBaseAndExtent(words[reverse ? last : first].firstChild!, 1, words[reverse ? first : last].firstChild!, 2)
  await act(async () => viewport.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
}
const combinationBook: Material = { ...material, chapters: [{ ...material.chapters[0], blocks: [{ ...material.chapters[0].blocks[0], text: 'alpha beta gap gamma delta' }] }] }
test.each([false, true])('combination accepts multiple drags with whole-word boundaries, reverse=%s', async reverse => {
  await render(combinationBook)
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '组合选词')!.click())
  await dragWords(0, 1, reverse)
  await dragWords(3, 4, reverse)
  expect(window.getSelection()?.toString()).toBe('')
  expect(container.querySelectorAll('.word.fragment')).toHaveLength(4)
  expect(voice.play).not.toHaveBeenCalled()
  expect(invoke.mock.calls.some(([command]) => command.type === 'lookup')).toBe(false)
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '完成（2）')!.click())
  expect(voice.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ combined: true, text: 'alpha beta … gamma delta', spans: [{ start: 0, end: 10 }, { start: 15, end: 26 }] }), 'zh-en')
})
test('combination merges overlapping drags and supports adding and removing clicked fragments', async () => {
  await render(combinationBook)
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '组合选词')!.click())
  await dragWords(0, 1)
  await dragWords(1, 2)
  await dragWords(0, 1)
  expect(container.querySelectorAll('.word.fragment')).toHaveLength(3)
  const words = [...container.querySelectorAll<HTMLSpanElement>('.word')]
  await act(async () => { words[4].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); words[4].click() })
  await act(async () => { words[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); words[1].click() })
  expect(container.querySelectorAll('.word.fragment')).toHaveLength(1)
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '完成（1）')!.click())
  expect(voice.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ combined: true, text: 'delta', spans: [{ start: 21, end: 26 }] }), 'zh-en')
})
test('combination drag respects Chinese segmentation and cancellation clears fragments', async () => {
  const book = { ...combinationBook, chapters: [{ ...combinationBook.chapters[0], blocks: [{ ...combinationBook.chapters[0].blocks[0], text: '你好世界朋友', tokens: [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }] }] }] }
  await render(book, 'en-zh')
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '组合选词')!.click())
  await dragWords(0, 1)
  expect(container.querySelectorAll('.word.fragment')).toHaveLength(2)
  expect(voice.play).not.toHaveBeenCalled()
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '取消组合')!.click())
  expect(container.querySelector('.fragment')).toBeNull()
  expect(voice.play).not.toHaveBeenCalled()
})

test('corner chapter button opens a menu and saves direct chapter selection', async () => {
  await render()
  expect(trigger().textContent).toBe('章节')
  expect(trigger().closest('.reader-toolbar')).not.toBeNull()
  expect(container.querySelector('.chapter-controls, .reader-chapter-navigation, .reader-footer')).toBeNull()
  for (const index of [2, 0, 1]) {
    await choose(`chapter-${index}`)
    expect(trigger().value).toBe(`chapter-${index}`)
    expect(invoke).toHaveBeenLastCalledWith({ type: 'progress', profile: 'zh-en', materialId: 'book', progress: { chapterId: `chapter-${index}`, blockId: `block-${index}`, offset: 0 } })
    expect(trigger().textContent).toBe('章节')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  }
})
test('chapter selection is available on any page and marks the current chapter', async () => {
  pagination.pageCount = 3
  await render()
  await act(async () => trigger().click())
  expect(document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('data-value')).toBe('chapter-0')
  expect(document.querySelector<HTMLElement>('[role="listbox"]')?.style.width).toBe('240px')
  await act(async () => document.querySelector<HTMLElement>('[data-value="chapter-1"]')!.click())
  expect(trigger().value).toBe('chapter-1')
})
test('selecting the current single chapter leaves reading progress untouched', async () => {
  await render({ ...material, chapters: material.chapters.slice(0, 1) })
  await choose('chapter-0')
  expect(invoke).not.toHaveBeenCalled()
  expect(trigger().value).toBe('chapter-0')
})

test('side arrows turn pages and the footer only shows the page count', async () => {
  pagination.page = 1; pagination.pageCount = 3
  pagination.showPage.mockClear()
  await render()
  const previous = container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')!
  const next = container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!
  expect(previous.closest('.reader-page-stage')).not.toBeNull()
  expect(next.closest('.reader-page-stage')).not.toBeNull()
  expect(previous.querySelector('svg')).not.toBeNull()
  expect(next.textContent).toBe('')
  expect(container.querySelector('.reader-pagination button')).toBeNull()
  expect(container.querySelector('.reader-pagination [role="status"]')?.textContent).toBe('第 2 / 3 页')
  await act(async () => previous.click())
  expect(pagination.showPage).toHaveBeenLastCalledWith(0)
  await act(async () => next.click())
  expect(pagination.showPage).toHaveBeenLastCalledWith(2)
})
test('side arrows disable the unavailable direction at material boundaries', async () => {
  pagination.pageCount = 3
  const singleChapter = { ...material, chapters: material.chapters.slice(0, 1) }
  await render(singleChapter)
  const previous = () => container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')!
  const next = () => container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!
  expect(previous().disabled).toBe(true)
  expect(next().disabled).toBe(false)
  pagination.page = 2
  await render(singleChapter)
  expect(previous().disabled).toBe(false)
  expect(next().disabled).toBe(true)
  pagination.page = 0; pagination.pageCount = 1
  await render(singleChapter)
  expect(previous().disabled).toBe(true)
  expect(next().disabled).toBe(true)
})

function queuedFrames() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  return async () => { await act(async () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)) }) }
}
test('chapter-end next arrow opens the next chapter at its first page', async () => {
  const flush = queuedFrames()
  pagination.page = 2; pagination.pageCount = 3
  await render()
  const next = container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!
  expect(next.disabled).toBe(false)
  await act(async () => next.click())
  expect(trigger().value).toBe('chapter-1')
  await flush()
  expect(pagination.showPage).toHaveBeenLastCalledWith(0)
  expect(invoke).toHaveBeenLastCalledWith({ type: 'progress', profile: 'zh-en', materialId: 'book', progress: { chapterId: 'chapter-1', blockId: 'block-1', offset: 0 } })
})
test('previous arrow at a chapter start opens the preceding last page and saves its location', async () => {
  const flush = queuedFrames()
  await render()
  await choose('chapter-1'); await flush()
  pagination.page = 0; pagination.pageCount = 3
  pagination.location.mockReturnValue({ blockId: 'block-0', offset: 0, textOffset: 6 })
  await render()
  const previous = container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')!
  expect(previous.disabled).toBe(false)
  await act(async () => previous.click())
  await flush()
  expect(trigger().value).toBe('chapter-0')
  expect(pagination.showPage).toHaveBeenLastCalledWith(Number.MAX_SAFE_INTEGER)
  expect(invoke).toHaveBeenLastCalledWith({ type: 'progress', profile: 'zh-en', materialId: 'book', progress: { chapterId: 'chapter-0', blockId: 'block-0', offset: 0, textOffset: 6 } })
})
test('keyboard can cross single-page chapters and pending chapters show segmentation', async () => {
  const flush = queuedFrames()
  const book = { ...material, chapters: material.chapters.map((chapter, index) => index === 1 ? { ...chapter, segmentation: 'pending' as const } : chapter) }
  await render(book)
  await act(async () => container.querySelector('.reader-content')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })))
  await flush()
  expect(trigger().value).toBe('chapter-1')
  expect(container.querySelector('.reader-content')).toBeNull()
  expect(container.textContent).toContain('处理 / 重试分词')
  await render(material)
  await flush()
  expect(pagination.showPage).toHaveBeenLastCalledWith(0)
})

test('backward crossing waits for delayed chapter images before choosing the final page', async () => {
  const flush = queuedFrames()
  const book: Material = { ...material, chapters: material.chapters.map((chapter, index) => index ? chapter : { ...chapter, blocks: [{ id: 'image', kind: 'image', text: '', emphasis: [], tokens: [], image: { source: '', asset: 'test.png', missing: false, caption: '' } }] }) }
  await render(book)
  await choose('chapter-1'); await flush()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')!.click())
  const image = container.querySelector('img')!
  Object.defineProperty(image, 'complete', { value: false, configurable: true })
  pagination.showPage.mockClear()
  await flush()
  expect(pagination.showPage).not.toHaveBeenCalled()
  expect(container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.disabled).toBe(true)
  Object.defineProperty(image, 'complete', { value: true, configurable: true })
  pagination.revision++
  await render(book); await flush()
  expect(pagination.showPage).toHaveBeenLastCalledWith(Number.MAX_SAFE_INTEGER)
  expect(container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.disabled).toBe(false)
})

test('crossing backward never restores stale progress after the final-page transition', async () => {
  vi.useFakeTimers()
  const flush = queuedFrames()
  await render({ ...material, progress: { chapterId: 'chapter-0', blockId: 'block-0', offset: 0, textOffset: 0 } })
  await act(async () => vi.runOnlyPendingTimers())
  await choose('chapter-1'); await flush()
  pagination.locate.mockClear()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')!.click())
  await flush()
  await act(async () => vi.runOnlyPendingTimers())
  expect(pagination.locate).not.toHaveBeenCalled()
  expect(pagination.showPage).toHaveBeenLastCalledWith(Number.MAX_SAFE_INTEGER)
})

test('the reader keeps the original chapter heading without adding its parsed title again', async () => {
  const book: Material = { ...material, chapters: [{ ...material.chapters[0], title: 'Chapter 1', blocks: [{ id: 'original-heading', kind: 'heading', text: 'Chapter 1', emphasis: [], tokens: [] }, ...material.chapters[0].blocks] }] }
  await render(book)
  const content = container.querySelector('.reader-content')!
  expect(content.textContent?.match(/Chapter 1/g)).toHaveLength(1)
  expect(content.querySelector('.reading-block.heading')?.textContent).toBe('Chapter 1')
  await act(async () => trigger().click())
  expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe('Chapter 1')
})
test('PDF Chinese pages read independently and segmentation retry targets only the current page', async () => {
  const book: Material = { ...material, kind: 'pdf', chapters: material.chapters.map((chapter, index) => ({ ...chapter, title: `Page ${index + 1}`, segmentation: index ? 'pending' : 'ready' })) }
  await render(book, 'en-zh')
  expect(container.querySelector('.reader-content')).not.toBeNull()
  await choose('chapter-1')
  expect(container.querySelector('.reader-content')).toBeNull()
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent === '处理 / 重试分词')!
  await act(async () => retry.click())
  expect(invoke).toHaveBeenLastCalledWith({ type: 'segment', profile: 'en-zh', materialId: book.id, chapterId: 'chapter-1' })
})
