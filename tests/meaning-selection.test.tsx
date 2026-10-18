// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { MeaningSidebar } from '../src/renderer/src/MeaningSidebar'
import { translate } from '../src/renderer/src/i18n'
import { flushDrafts } from '../src/renderer/src/api'
import { emptyState, selectionKey, type Profile, type Result, type Selection } from '../src/shared/domain'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const voice = vi.hoisted(() => ({ play: vi.fn(async () => {}) }))
vi.mock('../src/renderer/src/pronunciation', () => ({ pronunciation: voice }))
let root: Root | undefined
let container: HTMLDivElement
const selection: Selection = { materialId: 'meaning-material', chapterId: 'chapter', blockId: 'block', spans: [{ start: 0, end: 4 }], combined: false, text: 'bank', context: 'bank by the river' }
const save = vi.fn<() => Promise<Result>>()
const explanation = vi.fn<() => Promise<Result>>()
const invoke = vi.fn(async (command: { type: string }) => {
  if (command.type === 'lookup') return { meanings: [{ text: '银行', source: 'dictionary' as const }] }
  if (command.type === 'explain') return explanation()
  if (command.type === 'selectMeaning' || command.type === 'bind') return save()
  return {}
})
function SyncedSidebar({ initialProfile }: { initialProfile: Profile }) {
  const [profile, setProfile] = useState(initialProfile)
  return <MeaningSidebar selection={selection} profileId="zh-en" profile={profile} apply={result => { if (result.snapshot?.profile) setProfile(result.snapshot.profile) }} settings={() => {}} choose={() => {}} />
}
async function render(profile: Profile = emptyState().profiles['zh-en'], synced = false, selected = selection) {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container) }
  window.ling = { invoke, onCloseRequested: () => () => {} }
  save.mockResolvedValue({})
  explanation.mockResolvedValue({ meaning: { text: 'n. 河岸', source: 'AI' } })
  await act(async () => root!.render(synced ? <SyncedSidebar initialProfile={profile} /> : <MeaningSidebar key={selectionKey(selected)} selection={selected} profileId="zh-en" profile={profile} apply={() => {}} settings={() => {}} choose={() => {}} />))
}
afterEach(async () => {
  save.mockResolvedValue({})
  await act(async () => { await flushDrafts(); root?.unmount() })
  root = undefined; document.body.replaceChildren(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); explanation.mockReset()
})

test('one meanings list reserves a spinning AI candidate while dictionary candidates remain usable', async () => {
  let resolve!: (result: Result) => void
  explanation.mockImplementationOnce(() => new Promise(resolveExplanation => { resolve = resolveExplanation }))
  await render()
  expect(container.querySelectorAll('.candidate-section')).toHaveLength(1)
  expect(container.querySelector('.candidate-section h3')?.textContent).toBe('释义')
  expect(container.querySelector('.candidate-loading[role="status"][aria-busy="true"] .meaning-spinner')).not.toBeNull()
  expect(container.querySelector('.candidate-loading')?.textContent).toBe('正在生成释义…')
  const dictionary = container.querySelector<HTMLButtonElement>('button.candidate')!
  expect(dictionary.textContent).toBe('银行')
  expect(dictionary.disabled).toBe(false)
  await act(async () => dictionary.click())
  expect(invoke).toHaveBeenLastCalledWith({ type: 'selectMeaning', profile: 'zh-en', selection, meaning: { text: '银行', source: 'dictionary' } })
  await act(async () => resolve({ meaning: { text: 'n. 河岸', source: 'AI' } }))
  expect(container.querySelector('.candidate-loading')).toBeNull()
  expect([...container.querySelectorAll('button.candidate')].map(button => button.textContent)).toEqual(['n. 河岸', '银行'])
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="当前语境释义"]')?.value).toBe('银行')
})
test('the speaker after the selected heading repeats only the current selection without changing meanings or Keep', async () => {
  await render()
  const button = container.querySelector<HTMLButtonElement>('.lookup-heading [aria-label="重复发音"]')!
  expect(button.previousElementSibling?.tagName).toBe('H2')
  expect(button.querySelector('svg')).not.toBeNull()
  await act(async () => button.click())
  await act(async () => button.click())
  expect(voice.play).toHaveBeenCalledTimes(2)
  expect(voice.play).toHaveBeenLastCalledWith(selection, 'zh-en')
  expect(save).not.toHaveBeenCalled()
  expect(explanation).toHaveBeenCalledTimes(1)
  const next = { ...selection, text: 'elementary school', spans: [{ start: 0, end: 17 }] }
  await render(undefined, false, next)
  await act(async () => container.querySelector<HTMLButtonElement>('.pronunciation-button')!.click())
  expect(voice.play).toHaveBeenLastCalledWith(next, 'zh-en')
  expect(save).not.toHaveBeenCalled()
})
test('speaker playback failures can be retried without changing the selected text', async () => {
  await render()
  voice.play.mockRejectedValueOnce(new Error('发音暂不可用，请重试'))
  const button = container.querySelector<HTMLButtonElement>('.pronunciation-button')!
  await act(async () => button.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('发音暂不可用，请重试')
  await act(async () => button.click())
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(container.querySelector('h2')?.textContent).toBe(selection.text)
})

test('meaning input starts with one row, grows for selected content and refits after editing or resizing', async () => {
  let contentHeight = 84
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) { return this.value ? contentHeight : 24 })
  let notify: (entries: ResizeObserverEntry[]) => void = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notify = entries => callback(entries, {} as ResizeObserver) }
    observe() {}
    disconnect = disconnect
  })
  await render()
  const input = container.querySelector<HTMLTextAreaElement>('[aria-label="当前语境释义"]')!
  input.style.borderTopWidth = '1px'; input.style.borderBottomWidth = '1px'
  expect(input.rows).toBe(1)
  expect(input.style.height).toBe('')
  await act(async () => container.querySelector<HTMLButtonElement>('button.candidate')!.click())
  expect(input.style.height).toBe('86px')
  contentHeight = 28
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button.candidate')].find(button => button.textContent === '银行')!.click())
  expect(input.style.height).toBe('30px')
  contentHeight = 100
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(input.style.height).toBe('102px')
  contentHeight = 64
  await act(async () => notify([{ contentRect: { width: 180 } } as ResizeObserverEntry]))
  expect(input.style.height).toBe('66px')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(input.style.height).toBe('')
  expect(input.rows).toBe(1)
  await act(async () => root!.unmount()); root = undefined
  expect(disconnect).toHaveBeenCalled()
})

test('AI failure keeps dictionary results and retry available without a regeneration button', async () => {
  let reject!: (error: Error) => void
  explanation.mockImplementationOnce(() => new Promise((_resolve, rejectExplanation) => { reject = rejectExplanation }))
  await render()
  expect([...container.querySelectorAll('button')].some(button => button.textContent === '重新生成')).toBe(false)
  expect(container.querySelector('.candidate-loading')).not.toBeNull()
  expect([...container.querySelectorAll('button.candidate')].map(button => button.textContent)).toEqual(['银行'])
  await act(async () => reject(new Error('服务超时')))
  expect(container.querySelector('.candidate-loading')).toBeNull()
  expect(container.querySelector('.notice')?.textContent).toContain('服务超时')
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent === '重试')!
  await act(async () => retry.click())
  expect(container.querySelector('.notice')).toBeNull()
  expect([...container.querySelectorAll('button.candidate')].map(button => button.textContent)).toEqual(['n. 河岸', '银行'])
})

test('AI and dictionary candidates immediately select meaning through the atomic auto-Keep command', async () => {
  await render()
  const aiIcon = container.querySelector('.candidate-ai-icon')!
  expect(aiIcon.querySelector('svg')?.getAttribute('width')).toBe('14')
  expect(aiIcon.tagName).toBe('BUTTON')
  expect(aiIcon.getAttribute('aria-label')).toBe('重新生成')
  expect(container.querySelectorAll('.candidate-ai-icon')).toHaveLength(1)
  expect(aiIcon.closest('.ai-candidate')?.querySelector('button.candidate')?.textContent).toBe('n. 河岸')
  for (const candidate of [...container.querySelectorAll<HTMLButtonElement>('button.candidate')]) {
    await act(async () => candidate.click())
    expect(invoke).toHaveBeenLastCalledWith({ type: 'selectMeaning', profile: 'zh-en', selection, meaning: { text: candidate.textContent, source: candidate.textContent === '银行' ? 'dictionary' : 'AI' } })
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="当前语境释义"]')?.value).toBe(candidate.textContent)
  }
  expect(save).toHaveBeenCalledTimes(2)
  expect(invoke.mock.calls.some(([command]) => command.type === 'bind')).toBe(false)
})

test('the AI icon regenerates once without selecting a meaning or changing the saved input', async () => {
  await render()
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button.candidate')].find(button => button.textContent === '银行')!.click())
  const savesBefore = save.mock.calls.length
  let resolve!: (result: Result) => void
  explanation.mockImplementationOnce(() => new Promise(resolveExplanation => { resolve = resolveExplanation }))
  const icon = container.querySelector<HTMLButtonElement>('.candidate-ai-icon')!
  expect(icon.closest('button.candidate')).toBeNull()
  await act(async () => { icon.click(); icon.click() })
  expect(explanation).toHaveBeenCalledTimes(2)
  expect(invoke).toHaveBeenLastCalledWith({ type: 'explain', profile: 'zh-en', selection, regenerate: true })
  expect(save).toHaveBeenCalledTimes(savesBefore)
  expect(container.querySelector('.candidate-loading .meaning-spinner')).not.toBeNull()
  await act(async () => resolve({ meaning: { text: 'n. 新释义', source: 'AI' } }))
  expect(container.querySelector('.candidate-loading')).toBeNull()
  expect(container.querySelector('.ai-candidate button.candidate')?.textContent).toBe('n. 新释义')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="当前语境释义"]')?.value).toBe('银行')
  expect(save).toHaveBeenCalledTimes(savesBefore)
})
test('notes appear only for an active Keep and restore their saved content after reactivation', async () => {
  const profile = emptyState().profiles['zh-en']
  profile.contextNotes[selectionKey(selection)] = 'Legacy context note'
  await render(profile)
  expect(container.querySelector('.notes')).toBeNull()
  profile.keeps.push({ id: 'keep', selection, meaning: { text: '河岸', source: 'manual' }, active: true, level: 1, note: 'Saved Keep note', reviews: [], updatedAt: '', meaningUpdatedAt: '', card: { due: '', stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0 } })
  await render(profile)
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')?.value).toBe('Saved Keep note')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')?.rows).toBe(3)
  const notes = container.querySelector('.notes')!
  expect([...container.querySelectorAll('.candidate-section')].every(section => Boolean(section.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
  profile.keeps[0].active = false
  await render(profile)
  expect(container.querySelector('.notes')).toBeNull()
  profile.keeps[0].active = true
  await render(profile)
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')?.value).toBe('Saved Keep note')
  expect(profile.contextNotes[selectionKey(selection)]).toBe('Legacy context note')
})
test('manual input saves its binding without automatically creating a Keep', async () => {
  await render()
  await act(async () => {
    const field = container.querySelector<HTMLTextAreaElement>('[aria-label="当前语境释义"]')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '手动释义')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { expect(await flushDrafts()).toBe(true) })
  expect(invoke).toHaveBeenLastCalledWith({ type: 'bind', profile: 'zh-en', selection, meaning: { text: '手动释义', source: 'manual' } })
})
test('footer describes the saved Keep level and distinguishes ignored from never added', async () => {
  const profile = emptyState().profiles['zh-en']
  const hint = () => container.querySelector('.meaning-actions > p')?.textContent
  await render(profile)
  expect(hint()).toBe('选择释义或等级加入 Keep。')
  profile.keeps.push({ id: 'keep', selection, meaning: { text: '河岸', source: 'manual' }, active: true, level: 1, note: '', reviews: [], updatedAt: '', meaningUpdatedAt: '', card: { due: '', stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0 } })
  const descriptions = [
    '陌生：还不认识，需要学习这个语境中的用法。',
    '有印象：见过，但还不能确定含义。',
    '基本理解：能结合语境理解，还需要巩固。',
    '熟悉：能较轻松地理解这个语境中的用法。',
    '已掌握：能熟练理解这个语境中的用法。'
  ]
  const englishLabels = ['New:', 'Seen before:', 'Understood:', 'Familiar:', 'Mastered:']
  for (const [index, description] of descriptions.entries()) {
    profile.keeps[0].level = index + 1
    await render(profile)
    expect(hint()).toBe(description)
    expect(translate('en', description)).toContain(englishLabels[index])
  }
  profile.keeps[0].active = false
  await render(profile)
  expect(hint()).toBe('已忽略；笔记和复习历史会保留。')
  expect(translate('en', hint()!)).toBe('Ignored. Notes and review history are preserved.')
})
test('pending selection blocks duplicate clicks and failures retain an auto-Keep retry', async () => {
  await render()
  let reject!: (error: Error) => void
  save.mockImplementationOnce(() => new Promise((_resolve, rejectSave) => { reject = rejectSave }))
  const candidate = container.querySelector<HTMLButtonElement>('button.candidate')!
  await act(async () => { candidate.click(); candidate.click() })
  expect(container.querySelector('[aria-label="陌生"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.meaning-actions > p')?.textContent).toContain('陌生：')
  expect(save).toHaveBeenCalledTimes(1)
  expect([...container.querySelectorAll<HTMLButtonElement>('.candidate, .status-controls button')].every(button => button.disabled)).toBe(true)
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="当前语境释义"]')?.disabled).toBe(true)
  await act(async () => reject(new Error('disk full')))
  expect(container.querySelector('[aria-label="忽略"]')?.getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('.meaning-actions > p')?.textContent).toBe('选择释义或等级加入 Keep。')
  expect(container.textContent).toContain('disk full')
  expect(candidate.disabled).toBe(false)
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '重试保存')!.click())
  expect(invoke).toHaveBeenLastCalledWith({ type: 'selectMeaning', profile: 'zh-en', selection, meaning: { text: 'n. 河岸', source: 'AI' } })
  expect(container.textContent).not.toContain('已保存')
  expect(container.textContent).not.toContain('保存失败')
  expect(save).toHaveBeenCalledTimes(2)
})

test.each([1, 4])('candidate selection synchronizes footer before and after persistence, retaining level %i', async level => {
  const savedProfile = emptyState().profiles['zh-en']
  savedProfile.keeps.push({ id: 'saved-keep', selection, meaning: { text: 'n. 河岸', source: 'AI' }, active: true, level, note: '', reviews: [], updatedAt: '', meaningUpdatedAt: '', card: { due: '', stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0 } })
  await render(level === 1 ? emptyState().profiles['zh-en'] : structuredClone(savedProfile), true)
  let resolve!: (result: Result) => void
  save.mockImplementationOnce(() => new Promise(resolveSave => { resolve = resolveSave }))
  await act(async () => container.querySelector<HTMLButtonElement>('button.candidate')!.click())
  const label = level === 1 ? '陌生' : '熟悉'
  const verify = () => {
    expect(container.querySelector(`[aria-label="${label}"]`)?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.meaning-actions > p')?.textContent).toContain(`${label}：`)
    expect(container.querySelectorAll('.status-controls [aria-pressed="true"]')).toHaveLength(1)
  }
  verify()
  await act(async () => resolve({ snapshot: { activeProfile: 'zh-en', profile: savedProfile, ai: { provider: 'google-gemini', configs: {}, ollamaBaseUrl: 'http://127.0.0.1:11434' } } }))
  verify()
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Keep 笔记"]')).not.toBeNull()
})
