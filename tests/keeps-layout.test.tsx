// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { Keeps } from '../src/renderer/src/Keeps'
import { flushDrafts } from '../src/renderer/src/api'
import { I18nProvider, useI18n } from '../src/renderer/src/i18n'
import type { InterfaceLanguage, Keep, Profile } from '../src/shared/domain'
import { importText } from '../src/main/imports'
import { makeSelection } from '../src/shared/reading'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
const invoke = vi.fn().mockResolvedValue({})
const jump = vi.fn()
// jsdom has no native modal implementation; real focus trapping is checked in Electron.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; this.querySelector<HTMLButtonElement>('[autofocus]')?.focus() } },
  close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')) } }
})
function keep(id: string, active = true): Keep {
  return { id, active, level: 2, note: `Note ${id}`, updatedAt: `2026-10-${id === 'older' ? '17' : '18'}T00:00:00Z`, meaningUpdatedAt: '', reviews: [],
    selection: { materialId: id, chapterId: 'chapter', blockId: 'block', spans: [{ start: 0, end: id.length }], combined: false, text: id, context: `Context ${id}` },
    meaning: { text: `Meaning ${id}`, source: 'manual' },
    card: { due: '2020-01-01T00:00:00Z', stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0 } }
}
function Language({ language }: { language: InterfaceLanguage }) {
  const { setLanguage } = useI18n()
  useEffect(() => setLanguage(language), [language, setLanguage])
  return null
}
async function render(context?: string, language: InterfaceLanguage = 'zh', source?: 'valid' | 'invalid') {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  window.ling = { invoke, onCloseRequested: () => () => {} }
  const profile: Profile = { keeps: [keep('older'), keep('newer'), keep('removed', false)], materials: [], contextNotes: {}, aiCache: {}, bindings: {} }
  if (context !== undefined) profile.keeps[1].selection.context = context
  if (source) {
    const material = importText('newer context.', 'Source title', 'zh-en')
    profile.materials.push(material)
    profile.keeps[1].selection = makeSelection(material.id, material.chapters[0], [{ start: 0, end: 5 }])
    if (source === 'invalid') profile.keeps[1].selection.chapterId = 'missing'
  }
  await act(async () => root.render(<I18nProvider><Language language={language} /><Keeps profileId="zh-en" profile={profile} apply={() => {}} jump={jump} report={() => {}} /></I18nProvider>))
}
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.replaceChildren(); invoke.mockClear(); jump.mockClear() })

function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  return [...scope.querySelectorAll('button')].find(button => button.textContent === label)!
}
function checkbox(label: string): HTMLInputElement { return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)! }

test('bulk toolbar appears with selection and disappears after unchecking all items or select-all', async () => {
  await render()
  expect(container.querySelector('.keep-batch')).toBeNull()
  await act(async () => checkbox('选择 newer').click())
  expect(container.querySelector('.keep-batch')?.textContent).toContain('已选 1 条')
  await act(async () => checkbox('选择 older').click())
  await act(async () => checkbox('选择 newer').click())
  expect(container.querySelector('.keep-batch')?.textContent).toContain('已选 1 条')
  await act(async () => checkbox('选择 older').click())
  expect(container.querySelector('.keep-batch')).toBeNull()
  await act(async () => checkbox('全选当前结果').click())
  expect(container.querySelector('.keep-batch')?.textContent).toContain('已选 2 条')
  await act(async () => checkbox('全选当前结果').click())
  expect(container.querySelector('.keep-batch')).toBeNull()
})

test('bulk selection supports indeterminate, select all, clear and current filtered results only', async () => {
  await render()
  expect(container.querySelector('.keep-batch')).toBeNull()
  const all = checkbox('全选当前结果')
  await act(async () => checkbox('选择 newer').click())
  expect(all.indeterminate).toBe(true)
  expect(all.checked).toBe(false)
  expect(container.querySelector('dialog[open]')).toBeNull()
  await act(async () => all.click())
  expect(all.checked).toBe(true)
  expect(container.querySelectorAll('.is-selected')).toHaveLength(2)
  await act(async () => button('清空选择').click())
  expect(all.checked).toBe(false)
  expect(container.querySelectorAll('.is-selected')).toHaveLength(0)
  await act(async () => all.click())
  await type(container.querySelector<HTMLInputElement>('[aria-label="搜索 Keep"]')!, 'older')
  expect(container.querySelector('.keep-batch')).toBeNull()
  await act(async () => checkbox('全选当前结果').click())
  await act(async () => button('移出 Keep').click())
  expect(invoke).toHaveBeenCalledExactlyOnceWith({ type: 'batchKeeps', profile: 'zh-en', keepIds: ['older'], changes: { active: false } })
  expect(container.querySelector('.keep-batch')).toBeNull()
})

test('bulk failure retains selection for retry and pending actions reject repeated clicks', async () => {
  await render()
  await act(async () => checkbox('全选当前结果').click())
  invoke.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => button('移出 Keep').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('disk full')
  expect(container.querySelectorAll('.is-selected')).toHaveLength(2)
  let finish!: (value: {}) => void
  invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const remove = button('移出 Keep')
  await act(async () => { remove.click(); remove.click() })
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(remove.disabled).toBe(true)
  expect(checkbox('选择 newer').disabled).toBe(true)
  expect(container.querySelector<HTMLInputElement>('[aria-label="搜索 Keep"]')?.disabled).toBe(true)
  await act(async () => finish({}))
  expect(container.querySelector('.keep-batch')).toBeNull()
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

test('bulk restore and memory level changes include removed Keeps with explicit commands', async () => {
  await render()
  await act(async () => container.querySelector<HTMLInputElement>('.keep-filters [type="checkbox"]')!.click())
  await act(async () => checkbox('选择 removed').click())
  expect(button('移出 Keep').disabled).toBe(true)
  await act(async () => button('恢复 Keep').click())
  expect(invoke).toHaveBeenLastCalledWith({ type: 'batchKeeps', profile: 'zh-en', keepIds: ['removed'], changes: { active: true } })
  await act(async () => checkbox('选择 removed').click())
  const level = container.querySelector<HTMLButtonElement>('[aria-label="批量记忆等级"]')!
  await act(async () => level.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  await act(async () => level.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
  await act(async () => level.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await act(async () => button('应用等级').click())
  expect(invoke).toHaveBeenLastCalledWith({ type: 'batchKeeps', profile: 'zh-en', keepIds: ['removed'], changes: { level: 5, active: true } })
})

test('permanent deletion requires confirmation, supports cancel and retries failed deletion', async () => {
  await render()
  await act(async () => checkbox('全选当前结果').click())
  const dialog = container.querySelector<HTMLDialogElement>('.keep-delete-dialog')!
  await act(async () => button('永久删除').click())
  expect(dialog.open).toBe(true)
  expect(dialog.textContent).toContain('永久删除 2 条 Keep？')
  expect(dialog.textContent).toContain('无法恢复')
  expect(invoke).not.toHaveBeenCalled()
  await act(async () => button('取消', dialog).click())
  expect(dialog.open).toBe(false)
  expect(container.querySelectorAll('.is-selected')).toHaveLength(2)
  await act(async () => button('永久删除').click())
  invoke.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => button('确认永久删除', dialog).click())
  expect(dialog.open).toBe(true)
  expect(dialog.textContent).toContain('disk full')
  expect(container.querySelectorAll('.is-selected')).toHaveLength(2)
  await act(async () => button('确认永久删除', dialog).click())
  expect(invoke).toHaveBeenLastCalledWith({ type: 'deleteKeeps', profile: 'zh-en', keepIds: ['newer', 'older'] })
  expect(dialog.open).toBe(false)
  expect(container.querySelector('.keep-batch')).toBeNull()
})

test('permanent deletion stops if draft saving fails, then flushes before retrying deletion', async () => {
  await render()
  await act(async () => container.querySelector<HTMLButtonElement>('.keep-more')!.click())
  const detail = container.querySelector<HTMLDialogElement>('.keep-dialog')!
  await type(detail.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')!, 'Save before delete')
  await act(async () => detail.close())
  await act(async () => checkbox('选择 newer').click())
  await act(async () => button('永久删除').click())
  const dialog = container.querySelector<HTMLDialogElement>('.keep-delete-dialog')!
  invoke.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => button('确认永久删除', dialog).click())
  expect(dialog.textContent).toContain('仍有内容保存失败，请先重试保存')
  expect(invoke.mock.calls.some(([command]) => command.type === 'deleteKeeps')).toBe(false)
  await act(async () => button('确认永久删除', dialog).click())
  expect(invoke.mock.calls.slice(-2).map(([command]) => command.type)).toEqual(['editKeep', 'deleteKeeps'])
  expect(dialog.open).toBe(false)
})

test('selection does not carry over to another language profile', async () => {
  await render()
  await act(async () => checkbox('全选当前结果').click())
  const profile: Profile = { keeps: [keep('newer')], materials: [], contextNotes: {}, aiCache: {}, bindings: {} }
  await act(async () => root.render(<I18nProvider><Language language="zh" /><Keeps profileId="en-zh" profile={profile} apply={() => {}} jump={jump} report={() => {}} /></I18nProvider>))
  expect(checkbox('选择 newer').checked).toBe(false)
  expect(container.querySelector('.keep-batch')).toBeNull()
})

test.each([
  ['zh', ['词条', '释义', '原句']],
  ['en', ['Term', 'Meanings', 'Original sentence']]
] as const)('list has one %s column heading before the Keep rows', async (language, labels) => {
  await render(undefined, language)
  expect(container.querySelectorAll('.keep-list-heading')).toHaveLength(1)
  const list = container.querySelector('.keep-list')!
  expect(list.firstElementChild?.className).toBe('keep-heading-row')
  expect([...list.querySelector('.keep-list-heading')!.children].map(column => column.textContent)).toEqual(labels)
  await act(async () => container.querySelector<HTMLElement>('.keep-summary')!.click())
  expect(container.querySelectorAll('.keep-list-heading')).toHaveLength(1)
  const search = container.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!
  await type(search, 'no match')
  expect(container.querySelector('.keep-list-heading')).toBeNull()
})

test('all visible Keeps default to compact summaries in newest-first order', async () => {
  await render()
  const rows = [...container.querySelectorAll('.keep-list > article')]
  expect(rows.map(row => row.querySelector('.keep-term')?.textContent)).toEqual(['newer', 'older'])
  expect(container.querySelector('.keep-columns, .keep-list-item')).toBeNull()
  for (const row of rows) {
    const summary = row.querySelector<HTMLElement>('.keep-summary')!
    expect([...summary.children].map(child => child.className)).toEqual(['keep-term', 'keep-summary-meaning', 'keep-summary-context'])
    expect(summary.textContent).toContain('Meaning')
    expect(summary.textContent).toContain('Context')
    expect(summary.matches('button, [role="button"], [tabindex]')).toBe(false)
    expect(summary.hasAttribute('aria-expanded')).toBe(false)
    expect(row.querySelector<HTMLDialogElement>('dialog')?.open).toBe(false)
    expect(row.querySelector('.keep-more')?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(summary.querySelector('textarea, .status-controls, .level-badge')).toBeNull()
  }
})

test('search, removed filter and empty results apply to the complete rows', async () => {
  await render()
  await act(async () => container.querySelector<HTMLInputElement>('[type="checkbox"]')!.click())
  expect(container.querySelectorAll('.keep-list > article')).toHaveLength(3)
  const removed = [...container.querySelectorAll('article')].find(row => row.querySelector('.keep-term')?.textContent === 'removed')!
  expect(removed.querySelector('[aria-label="忽略"]')?.getAttribute('aria-pressed')).toBe('true')
  const search = container.querySelector<HTMLInputElement>('[aria-label="搜索 Keep"]')!
  await type(search, 'Meaning older')
  expect(container.querySelectorAll('.keep-list > article')).toHaveLength(1)
  expect(container.querySelector('article .keep-term')?.textContent).toBe('older')
  await type(search, 'no match')
  expect(container.querySelector('article')).toBeNull()
  expect(container.textContent).toContain('没有匹配内容')
})

test('editing different rows saves meaning, note and level to their own Keep', async () => {
  await render()
  const rows = container.querySelectorAll('article')
  await act(async () => rows[0].querySelector<HTMLButtonElement>('.keep-more')!.click())
  await type(rows[0].querySelector<HTMLTextAreaElement>('[aria-label="Keep 释义"]')!, 'New meaning')
  await act(async () => { rows[0].querySelector<HTMLDialogElement>('dialog')!.close(); rows[1].querySelector<HTMLButtonElement>('.keep-more')!.click() })
  await type(rows[1].querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')!, 'Older note')
  await act(async () => { expect(await flushDrafts()).toBe(true) })
  expect(invoke).toHaveBeenCalledWith({ type: 'editKeep', profile: 'zh-en', keepId: 'newer', changes: { meaning: { text: 'New meaning', source: 'manual' } } })
  expect(invoke).toHaveBeenCalledWith({ type: 'editKeep', profile: 'zh-en', keepId: 'older', changes: { note: 'Older note' } })
  await act(async () => rows[1].querySelector<HTMLButtonElement>('[aria-label="熟悉"]')!.click())
  expect(invoke).toHaveBeenCalledWith({ type: 'editKeep', profile: 'zh-en', keepId: 'older', changes: { level: 4, active: true } })
})

test('dialog omits the standalone level badge and gives both editors matching default rows', async () => {
  await render()
  await act(async () => container.querySelector<HTMLButtonElement>('.keep-more')!.click())
  const dialog = container.querySelector<HTMLDialogElement>('dialog')!
  expect(dialog.querySelector('.level-badge')).toBeNull()
  expect(dialog.textContent).not.toContain('下次复习')
  expect(dialog.textContent).not.toContain('已复习')
  expect(dialog.querySelectorAll('.status-controls button')).toHaveLength(6)
  const meaning = dialog.querySelector<HTMLTextAreaElement>('[aria-label="Keep 释义"]')!
  const note = dialog.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')!
  expect(note.rows).toBe(meaning.rows)
  expect(note.rows).toBe(3)
})

test('three-dot dialog preserves drafts and save retry across closing and reopening', async () => {
  await render()
  const rows = container.querySelectorAll('article')
  const summary = rows[0].querySelector<HTMLElement>('.keep-summary')!
  const more = rows[0].querySelector<HTMLButtonElement>('.keep-more')!
  const editor = rows[0].querySelector<HTMLDialogElement>('dialog')!
  await act(async () => more.click())
  expect(summary.hasAttribute('aria-expanded')).toBe(false)
  expect(editor.open).toBe(true)
  expect(editor.querySelector('h2')?.textContent).toBe('newer')
  expect(editor.querySelector('blockquote')?.textContent).toBe('Context newer')
  expect(editor.textContent).toContain('来源材料已删除')
  expect(rows[1].querySelector<HTMLDialogElement>('dialog')?.open).toBe(false)
  await type(editor.querySelector<HTMLTextAreaElement>('[aria-label="Keep 释义"]')!, 'Draft meaning')
  await type(editor.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')!, 'Draft note')
  await act(async () => editor.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click())
  expect(editor.open).toBe(false)
  expect(document.activeElement).toBe(more)
  expect(summary.querySelector('.keep-summary-meaning')?.textContent).toBe('Draft meaning')
  invoke.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => { expect(await flushDrafts()).toBe(false) })
  await act(async () => more.click())
  expect(editor.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')?.value).toBe('Draft note')
  expect(editor.textContent).toContain('disk full')
  await act(async () => [...editor.querySelectorAll('button')].find(button => button.textContent === '重试保存')!.click())
  expect(await flushDrafts()).toBe(true)
  expect(editor.textContent).not.toContain('disk full')
  expect(editor.open).toBe(true)
})

test.each(['valid', 'invalid'] as const)('dialog jumps to the %s source and closes', async source => {
  await render(undefined, 'zh', source)
  const row = container.querySelector('article')!
  await act(async () => row.querySelector<HTMLButtonElement>('.keep-more')!.click())
  const dialog = row.querySelector<HTMLDialogElement>('dialog')!
  const label = source === 'valid' ? '跳回原文 ↗' : '打开来源材料'
  expect(dialog.textContent).toContain('Source title')
  const sourceRow = dialog.querySelector('.keep-source')!
  expect(sourceRow.querySelector('p')?.textContent).toContain('Source title')
  const jumpButton = sourceRow.querySelector<HTMLButtonElement>('button')!
  expect(jumpButton.textContent).toBe(label)
  expect(sourceRow.lastElementChild).toBe(jumpButton)
  await act(async () => jumpButton.click())
  expect(dialog.open).toBe(false)
  expect(jump).toHaveBeenCalledTimes(1)
  expect(jump.mock.calls[0][0].title).toBe('Source title')
  if (source === 'valid') expect(jump.mock.calls[0][1].text).toBe('newer')
  else expect(jump.mock.calls[0][1]).toBeUndefined()
})

test('English three-dot dialog labels and close button follow the interface language', async () => {
  await render(undefined, 'en')
  const more = container.querySelector<HTMLButtonElement>('.keep-more')!
  expect(more.getAttribute('aria-label')).toBe('View full details for newer')
  await act(async () => more.click())
  const dialog = container.querySelector<HTMLDialogElement>('dialog')!
  expect(dialog.querySelector('[aria-label="Keep meaning"]')).not.toBeNull()
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
  expect(dialog.open).toBe(false)
})

test.each(['Short sentence.', 'First line\nSecond line\nThird line\n第四行原句', 'Long context '.repeat(100)])('clicking summary does not expand; full context is available through dots: %.30s', async context => {
  await render(context)
  const summary = container.querySelector<HTMLElement>('.keep-summary')!
  const original = summary.querySelector('.keep-summary-context')!
  const originalMarkup = summary.outerHTML
  expect(original.textContent).toBe(context)
  await act(async () => { summary.querySelector<HTMLElement>('.keep-term')!.click(); summary.click() })
  expect(summary.outerHTML).toBe(originalMarkup)
  expect(container.querySelector('dialog[open], .keep-editor, .keep-summary[aria-expanded]')).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
  expect(jump).not.toHaveBeenCalled()
  await act(async () => container.querySelector<HTMLButtonElement>('.keep-more')!.click())
  expect(container.querySelector('dialog[open] blockquote')?.textContent).toBe(context)
})

test('review can still open and return to the full list', async () => {
  await render()
  await act(async () => container.querySelector<HTMLButtonElement>('.page-heading button')!.click())
  expect(container.querySelector('.review-card')).not.toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('.review header button')!.click())
  expect(container.querySelectorAll('.keep-list > article')).toHaveLength(2)
})
