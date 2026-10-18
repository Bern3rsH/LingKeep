// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from '../src/renderer/src/App'
import { translate } from '../src/renderer/src/i18n'
import { emptyState, type Snapshot, type Result } from '../src/shared/domain'

vi.mock('../src/renderer/src/Reader', () => ({ Reader: ({ settings, initialSelection, onSelection }: any) => <div data-testid="reader"><span>{initialSelection?.text}</span><button onClick={() => { onSelection({ text: 'bank' }); settings() }}>前往设置</button></div> }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let container: HTMLDivElement
const state = emptyState()
const snapshot: Snapshot = { activeProfile: 'zh-en', profile: state.profiles['zh-en'], ai: { provider: 'openai', ollamaBaseUrl: state.ai.ollamaBaseUrl, configs: {} } }
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks() })
async function mount(initial = snapshot) {
  const invoke = vi.fn(async (command: any): Promise<Result> => ({ snapshot: command.type === 'profile' ? { ...initial, activeProfile: command.profile, profile: initial.profile ?? state.profiles[command.profile as keyof typeof state.profiles] } : initial }))
  window.ling = { invoke, onCloseRequested: () => () => {} }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<App />))
  return invoke
}
const ui = (message: string) => translate(document.documentElement.lang === 'en' ? 'en' : 'zh', message)
async function click(text: string) {
  text = text === '⚙Setting' ? ui('Setting') : text === '◇Keep0' ? ui('Keep') + '0' : ui(text)
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === text && !item.closest('[hidden]'))
  expect(button, text).toBeDefined()
  await act(async () => button!.click())
}
async function change(element: HTMLInputElement | HTMLButtonElement, value: string) {
  if (element.getAttribute('role') === 'combobox') {
    await act(async () => (element as HTMLButtonElement).click())
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.dataset.value === value)
    expect(option, value).toBeDefined()
    await act(async () => option!.click())
  } else {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
}
test('settings occupies its own page; category navigation retains model drafts; return restores Keep', async () => {
  await mount(); await click('◇Keep0'); await click('⚙Setting')
  expect(container.querySelector('.app-shell')).toBeNull()
  expect(container.querySelector('.navigation')).toBeNull()
  expect(container.querySelector('h1')?.textContent).toBe(ui('模型'))
  const key = container.querySelector<HTMLInputElement>('input[type="password"]')!
  await change(key, 'test-key')
  expect([...container.querySelectorAll('.settings-categories button')].map(button => button.textContent)).toEqual(['模型', '学习语言', '界面语言'])
  const dictionaries = [...container.querySelectorAll('h2')].find(heading => heading.textContent === '离线词库')
  expect(dictionaries?.closest('section')?.hidden).toBe(true)
  await click('学习语言')
  expect(container.querySelector('h1')?.textContent).toBe(ui('学习语言'))
  expect(key.closest('section')!.hidden).toBe(true)
  await click('模型'); expect(key.value).toBe('test-key'); expect(key.closest('section')!.hidden).toBe(false)
  await click('返回')
  expect(container.querySelector('.navigation')).not.toBeNull()
  expect(container.querySelector('h1')?.textContent).toBe(ui('Keep'))
})
test('save failure retains inputs and allows retry; language change opens the other Library', async () => {
  const invoke = await mount(); await click('⚙Setting')
  const key = container.querySelector<HTMLInputElement>('input[type="password"]')!
  await change(key, 'test-key')
  invoke.mockRejectedValueOnce(new Error('磁盘写入失败'))
  await click('保存设置')
  expect(container.querySelector('[role="status"]')?.textContent).toContain('磁盘写入失败')
  expect(key.value).toBe('test-key')
  await click('保存设置'); expect(key.value).toBe('')
  expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'settings', key: 'test-key' }))
  await click('学习语言')
  await click('重新选择')
  await change(nativeSelect(), 'en')
  await change(learningSelect(), 'zh')
  await click('保存学习语言')
  expect(invoke).toHaveBeenLastCalledWith({ type: 'profile', profile: 'en-zh' })
  expect(container.querySelector('.settings-shell')).toBeNull()
  expect(container.querySelector('h1')?.textContent).toBe(ui('Library'))
})
test('opening settings from reading returns to the same material and selection', async () => {
  const material = { id: 'material', title: 'Study', kind: 'text' as const, source: '', fingerprint: '', chapters: [{ id: 'chapter', title: '', blocks: [], segmentation: 'ready' as const }], createdAt: '' }
  await mount({ ...snapshot, profile: { ...state.profiles['zh-en'], materials: [material] } })
  await act(async () => container.querySelector<HTMLButtonElement>('.cover')!.click())
  await click('前往 Setting')
  expect(container.querySelector('.settings-shell')).not.toBeNull()
  await click('返回')
  expect(container.querySelector('[data-testid="reader"] span')?.textContent).toBe('bank')
})

function modelSelect() { return container.querySelector<HTMLButtonElement>('[aria-label="模型"]')! }
function providerSelect() { return container.querySelector<HTMLButtonElement>('[aria-label="模型服务商"]')! }
function refreshButton() { return container.querySelector<HTMLButtonElement>('[aria-label="刷新模型列表"]')! }
async function refreshModels() { await act(async () => refreshButton().click()) }

test('model names and refresh require credentials; provider switches restore only their saved model', async () => {
  await mount({ ...snapshot, ai: { ...snapshot.ai, configs: { openai: { hasKey: false, source: 'missing', model: 'hidden-model' }, deepseek: { hasKey: true, source: 'environment', model: 'deepseek-chat' } } } })
  await click('⚙Setting')
  expect(modelSelect().disabled).toBe(true); expect(refreshButton().disabled).toBe(true)
  expect(modelSelect().textContent).not.toContain('hidden-model')
  await change(providerSelect(), 'deepseek')
  expect(modelSelect().value).toBe('deepseek-chat'); expect(modelSelect().disabled).toBe(false)
  expect(container.textContent).toContain('正在使用环境变量密钥')
  await change(container.querySelector<HTMLInputElement>('input[type="password"]')!, 'draft-key')
  await change(providerSelect(), 'openai')
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
  expect(modelSelect().disabled).toBe(true)
})

test('saved key is masked, focus clears the mask, and untouched save never submits mask text', async () => {
  const initial: Snapshot = { ...snapshot, ai: { ...snapshot.ai, configs: { openai: { hasKey: true, source: 'app', model: 'saved-model' } } } }
  const invoke = await mount(initial); await click('⚙Setting')
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!
  expect(input.value).toBe('••••••••')
  await act(async () => input.focus()); expect(input.value).toBe('')
  await act(async () => input.blur()); expect(input.value).toBe('••••••••')
  await click('保存设置')
  expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'settings', key: '', model: 'saved-model' }))
  invoke.mockResolvedValueOnce({ snapshot: { ...initial, ai: { ...initial.ai, configs: {} } } })
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="删除 OpenAI 已保存的密钥"]')!.click())
  expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'settings', removeKey: true, key: '' }))
  expect(input.value).toBe(''); expect(modelSelect().disabled).toBe(true)
})

test('refresh marks missing model unavailable, selection repairs it, and failed refresh is retryable', async () => {
  const invoke = await mount({ ...snapshot, ai: { ...snapshot.ai, configs: { openai: { hasKey: true, source: 'app', model: 'old-model' } } } })
  await click('⚙Setting')
  invoke.mockResolvedValueOnce({ models: ['new-model'] }); await refreshModels()
  expect(modelSelect().textContent).toBe('old-model（不可用）')
  expect(container.querySelector<HTMLButtonElement>('.model-settings [type="submit"]')!.disabled).toBe(true)
  await change(modelSelect(), 'new-model')
  expect(container.querySelector<HTMLButtonElement>('.model-settings [type="submit"]')!.disabled).toBe(false)
  await click('保存设置')
  expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'new-model' }))
  invoke.mockRejectedValueOnce(new Error('网络连接失败')); await refreshModels()
  expect(container.querySelector('[role="status"]')?.textContent).toContain('网络连接失败')
  expect(refreshButton().disabled).toBe(false)
  invoke.mockResolvedValueOnce({ models: [] }); await refreshModels()
  expect(container.querySelector('[role="status"]')?.textContent).toContain('未找到可用')
})

test('Ollama URL edits clear models; refresh uses new URL and locks fields while pending', async () => {
  const invoke = await mount({ ...snapshot, ai: { ...snapshot.ai, provider: 'ollama', configs: { ollama: { hasKey: false, source: 'missing', model: 'old-local' } } } })
  await click('⚙Setting')
  expect(container.querySelector('input[type="password"]')).toBeNull()
  expect(modelSelect().value).toBe('old-local'); expect(refreshButton().disabled).toBe(false)
  const address = container.querySelector<HTMLInputElement>('[aria-label="Ollama 服务地址"]')!
  await change(address, 'http://localhost:12345')
  expect(modelSelect().value).toBe(''); expect(modelSelect().textContent).not.toContain('old-local')
  let resolve!: (result: Result) => void
  invoke.mockImplementationOnce(() => new Promise<Result>(done => { resolve = done }))
  await refreshModels()
  expect(providerSelect().disabled).toBe(true); expect(address.disabled).toBe(true); expect(modelSelect().disabled).toBe(true)
  expect(invoke).toHaveBeenLastCalledWith({ type: 'models', provider: 'ollama', key: '', ollamaBaseUrl: 'http://localhost:12345' })
  await act(async () => resolve({ models: ['local-model'] }))
  expect(providerSelect().disabled).toBe(false)
  await change(modelSelect(), 'local-model'); await click('保存设置')
  expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'ollama', model: 'local-model', ollamaBaseUrl: 'http://localhost:12345' }))
})

function nativeSelect() { return container.querySelector<HTMLButtonElement>('[name="native-language"]')! }
function learningSelect() { return container.querySelector<HTMLButtonElement>('[name="learning-language"]')! }
async function languageValues(select: HTMLButtonElement) {
  await act(async () => select.click())
  const values = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(option => option.dataset.value).filter(Boolean)
  await act(async () => select.click())
  return values
}
function languageSave() { return [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => [ui('保存学习语言'), ui('切换中…')].includes(button.textContent || ''))! }

test('language selectors exclude each other in either order and require a complete new pair', async () => {
  const invoke = await mount(); await click('⚙Setting'); await click('学习语言')
  expect(nativeSelect().value).toBe('zh'); expect(learningSelect().value).toBe('en')
  expect(await languageValues(nativeSelect())).toEqual(['zh']); expect(await languageValues(learningSelect())).toEqual(['en', 'fr'])
  expect(languageSave().disabled).toBe(true)
  await click('重新选择')
  expect(nativeSelect().value).toBe(''); expect(learningSelect().value).toBe('')
  expect(await languageValues(nativeSelect())).toEqual(['zh', 'en'])
  expect(await languageValues(learningSelect())).toEqual(['zh', 'en', 'fr'])
  await change(nativeSelect(), 'en')
  expect(await languageValues(learningSelect())).toEqual(['zh', 'fr']); expect(languageSave().disabled).toBe(true)
  await change(nativeSelect(), '')
  await change(learningSelect(), 'zh')
  expect(await languageValues(nativeSelect())).toEqual(['en']); expect(languageSave().disabled).toBe(true)
  await change(nativeSelect(), 'en')
  expect(languageSave().disabled).toBe(false)
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'profile' }))
  await click('保存学习语言')
  expect(invoke).toHaveBeenLastCalledWith({ type: 'profile', profile: 'en-zh' })
})

test('language selection failure retains drafts, pending switch prevents duplicates, and retry succeeds', async () => {
  const invoke = await mount(); await click('⚙Setting'); await click('学习语言'); await click('重新选择')
  await change(learningSelect(), 'zh'); await change(nativeSelect(), 'en')
  invoke.mockRejectedValueOnce(new Error('用户切换失败')); await click('保存学习语言')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('用户切换失败')
  expect(nativeSelect().value).toBe('en'); expect(learningSelect().value).toBe('zh')
  let resolve!: (result: Result) => void
  invoke.mockImplementationOnce(() => new Promise<Result>(done => { resolve = done }))
  await click('保存学习语言')
  expect(nativeSelect().disabled).toBe(true); expect(learningSelect().disabled).toBe(true)
  expect(languageSave().disabled).toBe(true)
  const calls = invoke.mock.calls.length
  await act(async () => languageSave().click())
  expect(invoke.mock.calls).toHaveLength(calls)
  await act(async () => resolve({ snapshot: { ...snapshot, activeProfile: 'en-zh' } }))
  expect(container.querySelector('.settings-shell')).toBeNull()
  expect(container.querySelector('h1')?.textContent).toBe(ui('Library'))
})

test('reverse profile restores both language fields and clearing a choice restores the other option', async () => {
  await mount({ ...snapshot, activeProfile: 'en-zh' }); await click('⚙Setting'); await click('学习语言')
  expect(nativeSelect().value).toBe('en'); expect(learningSelect().value).toBe('zh')
  expect(await languageValues(nativeSelect())).toEqual(['en']); expect(await languageValues(learningSelect())).toEqual(['zh', 'fr'])
  await change(nativeSelect(), '')
  expect(await languageValues(learningSelect())).toEqual(['zh', 'en', 'fr'])
  expect(languageSave().disabled).toBe(true)
})

const firstLaunch: Snapshot = { ...snapshot, activeProfile: null, profile: null }
test.each(['zh', 'en'] as const)('first launch supports %s-native French learning and restores its selectors', async native => {
  const invoke = await mount(firstLaunch)
  await change(nativeSelect(), native)
  expect(await languageValues(learningSelect())).toContain('fr')
  await change(learningSelect(), 'fr')
  expect(await languageValues(nativeSelect())).toEqual(['zh', 'en'])
  await click('进入 Library →')
  expect(invoke).toHaveBeenLastCalledWith({ type: 'profile', profile: `${native}-fr` })
  expect(document.documentElement.lang).toBe(native === 'zh' ? 'zh-CN' : 'en')
  await click('⚙Setting'); await click('学习语言')
  expect(nativeSelect().value).toBe(native)
  expect(learningSelect().value).toBe('fr')
  expect(languageSave().disabled).toBe(true)
})
function enterButton() { return container.querySelector<HTMLButtonElement>('.onboarding button[type="submit"]')! }

test.each(['native-first', 'learning-first'])('first launch separates languages with mutual exclusion: %s', async order => {
  const invoke = await mount(firstLaunch)
  expect(nativeSelect().value).toBe(''); expect(learningSelect().value).toBe('')
  expect(await languageValues(nativeSelect())).toEqual(['zh', 'en'])
  expect(await languageValues(learningSelect())).toEqual(['zh', 'en', 'fr'])
  expect(enterButton().disabled).toBe(true)
  if (order === 'native-first') {
    await change(nativeSelect(), 'zh')
    expect(await languageValues(learningSelect())).toEqual(['en', 'fr'])
    expect(enterButton().disabled).toBe(true)
    await change(learningSelect(), 'en')
  } else {
    await change(learningSelect(), 'zh')
    expect(await languageValues(nativeSelect())).toEqual(['en'])
    expect(enterButton().disabled).toBe(true)
    await change(nativeSelect(), 'en')
  }
  expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'profile' }))
  expect(enterButton().disabled).toBe(false)
  await change(learningSelect(), '')
  expect(enterButton().disabled).toBe(true)
  expect(await languageValues(nativeSelect())).toEqual(['zh', 'en'])
  await change(learningSelect(), order === 'native-first' ? 'en' : 'zh')
  await click('进入 Library →')
  expect(invoke).toHaveBeenLastCalledWith({ type: 'profile', profile: order === 'native-first' ? 'zh-en' : 'en-zh' })
  expect(container.querySelector('.onboarding')).toBeNull()
  expect(container.querySelector('h1')?.textContent).toBe(ui('Library'))
})

test('first launch failure keeps both selections and pending entry prevents repeated submissions', async () => {
  const invoke = await mount(firstLaunch)
  await change(nativeSelect(), 'zh'); await change(learningSelect(), 'en')
  invoke.mockRejectedValueOnce(new Error('保存用户失败')); await click('进入 Library →')
  expect(container.querySelector('.onboarding .error')?.textContent).toBe('保存用户失败')
  expect(nativeSelect().value).toBe('zh'); expect(learningSelect().value).toBe('en')
  expect(enterButton().disabled).toBe(false)
  let resolve!: (result: Result) => void
  invoke.mockImplementationOnce(() => new Promise<Result>(done => { resolve = done }))
  await click('进入 Library →')
  expect(nativeSelect().disabled).toBe(true); expect(learningSelect().disabled).toBe(true)
  expect(enterButton().disabled).toBe(true)
  const calls = invoke.mock.calls.length
  await act(async () => enterButton().click())
  expect(invoke.mock.calls).toHaveLength(calls)
  await act(async () => resolve({ snapshot }))
  expect(container.querySelector('.onboarding')).toBeNull()
})
