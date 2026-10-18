// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { ContextNoteEditor } from '../src/renderer/src/Notes'
import { flushDrafts } from '../src/renderer/src/api'
import type { Result, Selection, Span } from '../src/shared/domain'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let container: HTMLDivElement
const invoke = vi.fn().mockResolvedValue({})
const selection: Selection = { materialId: 'material', chapterId: 'chapter', blockId: 'block', spans: [{ start: 0, end: 4 }], combined: false, text: 'bank', context: 'bank by the river' }
async function render(keepId?: string, initialNote = '', selected = selection, initialAI?: Span[]) {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  window.ling = { invoke, onCloseRequested: () => () => {} }
  await act(async () => root!.render(<ContextNoteEditor key={selected.text} profileId="zh-en" selection={selected} initialNote={initialNote} initialAI={initialAI} keepId={keepId} apply={() => {}} />))
}
async function type(value: string) {
  await act(async () => {
    const field = container.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); invoke.mockReset(); invoke.mockResolvedValue({}); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('context notes save literal plain text and line breaks without Markdown previews', async () => {
  await render()
  expect(container.querySelector('[aria-label="语境笔记"]')).not.toBeNull()
  const text = '**My note**\n<script>not executable</script>'
  await type(text)
  await act(async () => { expect(await flushDrafts()).toBe(true) })
  expect(invoke).toHaveBeenLastCalledWith({ type: 'contextNote', profile: 'zh-en', selection, note: text })
  expect(container.querySelector('textarea')?.value).toBe(text)
  expect(container.querySelector('textarea')?.placeholder).not.toContain('Markdown')
  expect(container.querySelector('.markdown, strong, script')).toBeNull()
  expect([...container.querySelectorAll('button')].some(button => button.textContent === '预览')).toBe(false)
})
test('existing Keep notes retain their original text without interpreting formatting', async () => {
  const text = '# Heading\n**Literal text**\n[link](https://example.com)'
  await render('existing-keep', text)
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')?.value).toBe(text)
  expect(container.querySelector('.markdown, a, strong')).toBeNull()
  expect(container.querySelector('.note-input [aria-label="AI 语境讲解"]')).not.toBeNull()
})
test('joining Keep before the debounce fires preserves the draft and saves to that Keep', async () => {
  vi.useFakeTimers()
  await render()
  await type('Not saved yet')
  await render('new-keep', '')
  expect(container.querySelector('textarea')?.value).toBe('Not saved yet')
  await act(async () => { expect(await flushDrafts()).toBe(true) })
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith({ type: 'editKeep', profile: 'zh-en', keepId: 'new-keep', changes: { note: 'Not saved yet' } })
})
test('failed context note saves retain input and retry without requiring Keep', async () => {
  await render()
  await type('Preserve this')
  invoke.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => { expect(await flushDrafts()).toBe(false) })
  expect(container.querySelector('textarea')?.value).toBe('Preserve this')
  expect(container.textContent).toContain('disk full')
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '重试保存')!.click())
  expect(container.textContent).not.toContain('已保存')
  expect(container.textContent).not.toContain('保存失败')
  expect(await flushDrafts()).toBe(true)
})

test('AI note explanation appends plain text and autosaves without replacing existing notes', async () => {
  await render('existing-keep', 'My note')
  invoke.mockResolvedValueOnce({ explanation: 'Here bank means the side of the river.\nIt is a noun.' })
  await act(async () => container.querySelector<HTMLButtonElement>('.note-ai-button')!.click())
  expect(invoke).toHaveBeenCalledWith({ type: 'explainNote', profile: 'zh-en', selection })
  const expected = 'My note\n\nHere bank means the side of the river.\nIt is a noun.'
  expect(container.querySelector('textarea')?.value).toBe(expected)
  await act(async () => { expect(await flushDrafts()).toBe(true) })
  expect(invoke).toHaveBeenLastCalledWith({ type: 'editKeep', profile: 'zh-en', keepId: 'existing-keep', changes: { note: expected, noteAI: [{ start: 7, end: expected.length }] } })
})
test('AI requests show loading, prevent double submission, and preserve edits made while waiting', async () => {
  await render()
  let resolve!: (result: Result) => void
  invoke.mockImplementationOnce(() => new Promise<Result>(done => { resolve = done }))
  const button = container.querySelector<HTMLButtonElement>('.note-ai-button')!
  await act(async () => { button.click(); button.click() })
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(button.disabled).toBe(true)
  expect(button.getAttribute('aria-busy')).toBe('true')
  expect(button.querySelector('.meaning-spinner')).not.toBeNull()
  await type('Added while waiting')
  await act(async () => resolve({ explanation: 'Explanation' }))
  expect(container.querySelector('textarea')?.value).toBe('Added while waiting\n\nExplanation')
  expect(button.disabled).toBe(false)
  await act(async () => { await flushDrafts() })
})
test('regeneration replaces prior AI output while preserving manual text before, after and inside it', async () => {
  await render('keep', 'Manual note')
  const generate = async (explanation: string) => {
    invoke.mockResolvedValueOnce({ explanation })
    await act(async () => container.querySelector<HTMLButtonElement>('.note-ai-button')!.click())
  }
  await generate('First AI explanation')
  await type('Manual note\n\nFirst AI [my addition] explanation')
  await type('Manual note\n\nFirst AI [my addition] explanation\nManual ending')
  await generate('New AI explanation')
  const text = container.querySelector('textarea')!.value
  expect(text).toContain('Manual note')
  expect(text).toContain('[my addition]')
  expect(text).toContain('Manual ending')
  expect(text).toContain('New AI explanation')
  expect(text).not.toContain('First AI')
  await generate('Latest AI explanation')
  expect(container.querySelector('textarea')!.value).not.toContain('New AI explanation')
  expect(container.querySelector('textarea')!.value).toContain('Latest AI explanation')
  await act(async () => { await flushDrafts() })
})
test('reopening a saved note retains AI ownership and replaces only the stored generated content', async () => {
  const text = 'Manual\n\nSaved AI'
  await render('keep', text, selection, [{ start: 6, end: text.length }])
  invoke.mockResolvedValueOnce({ explanation: 'Refreshed AI' })
  await act(async () => container.querySelector<HTMLButtonElement>('.note-ai-button')!.click())
  expect(container.querySelector('textarea')!.value).toBe('Manual\n\nRefreshed AI')
  await act(async () => { await flushDrafts() })
})
test('failed regeneration preserves existing generated text and unsaved source metadata survives remount', async () => {
  await render('keep', 'Manual')
  invoke.mockResolvedValueOnce({ explanation: 'First AI' })
  await act(async () => container.querySelector<HTMLButtonElement>('.note-ai-button')!.click())
  invoke.mockRejectedValueOnce(new Error('offline'))
  await act(async () => container.querySelector<HTMLButtonElement>('.note-ai-button')!.click())
  expect(container.querySelector('textarea')!.value).toBe('Manual\n\nFirst AI')
  invoke.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => { expect(await flushDrafts()).toBe(false) })
  invoke.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => root!.unmount()); root = undefined
  await render('keep', 'Manual')
  expect(container.querySelector('textarea')!.value).toBe('Manual\n\nFirst AI')
  invoke.mockResolvedValueOnce({ explanation: 'Second AI' })
  await act(async () => container.querySelector<HTMLButtonElement>('.note-ai-button')!.click())
  expect(container.querySelector('textarea')!.value).toBe('Manual\n\nSecond AI')
  await act(async () => { await flushDrafts() })
})
test('AI failures and empty results preserve notes and allow retry', async () => {
  await render('keep', 'Original')
  invoke.mockRejectedValueOnce(new Error('请先配置 AI'))
  const button = container.querySelector<HTMLButtonElement>('.note-ai-button')!
  await act(async () => button.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('请先配置 AI')
  expect(container.querySelector('textarea')?.value).toBe('Original')
  invoke.mockResolvedValueOnce({ explanation: ' ' })
  await act(async () => button.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('AI 讲解内容无效')
  invoke.mockResolvedValueOnce({ explanation: 'Retry succeeded' })
  await act(async () => button.click())
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(container.querySelector('textarea')?.value).toBe('Original\n\nRetry succeeded')
  await act(async () => { await flushDrafts() })
})
test('switching selections ignores the previous AI response and does not save it elsewhere', async () => {
  await render('first', 'First note')
  let resolve!: (result: Result) => void
  invoke.mockImplementationOnce(() => new Promise<Result>(done => { resolve = done }))
  await act(async () => container.querySelector<HTMLButtonElement>('.note-ai-button')!.click())
  await render('second', 'Second note', { ...selection, text: 'river', spans: [{ start: 12, end: 17 }] })
  await act(async () => resolve({ explanation: 'Old explanation' }))
  expect(container.querySelector('textarea')?.value).toBe('Second note')
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(await flushDrafts()).toBe(true)
})

test('AI explanation expands the note input, refits on width changes and shrinks after editing', async () => {
  let width = 300, contentHeight = 200
  let resized!: () => void
  vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLTextAreaElement.prototype, 'offsetHeight', 'get').mockReturnValue(72)
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight)
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect = disconnect })
  await render('keep')
  const input = container.querySelector('textarea')!
  input.style.border = '1px solid black'
  expect(input.style.height).toBe('')
  invoke.mockResolvedValueOnce({ explanation: 'A long explanation.\nAnother paragraph.' })
  await act(async () => container.querySelector<HTMLButtonElement>('.note-ai-button')!.click())
  expect(input.style.height).toBe('202px')
  width = 200; contentHeight = 320
  await act(async () => resized())
  expect(input.style.height).toBe('322px')
  contentHeight = 30
  await type('Short note')
  expect(input.style.height).toBe('72px')
  await type('')
  expect(input.style.height).toBe('')
  await act(async () => { await flushDrafts(); root!.unmount() }); root = undefined
  expect(disconnect).toHaveBeenCalled()
})
test('saved notes in a hidden dialog fit after it becomes visible and on window resize', async () => {
  let width = 0, contentHeight = 220
  let resized!: () => void
  vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  vi.spyOn(HTMLTextAreaElement.prototype, 'offsetHeight', 'get').mockReturnValue(72)
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight)
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect() {} })
  await render('keep', 'Saved long explanation')
  const input = container.querySelector('textarea')!
  input.style.border = '1px solid black'
  expect(input.style.height).toBe('')
  width = 240
  await act(async () => resized())
  expect(input.style.height).toBe('222px')
  contentHeight = 260
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(input.style.height).toBe('262px')
})
