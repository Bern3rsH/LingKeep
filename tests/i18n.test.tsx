// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { App } from '../src/renderer/src/App'
import { translate, languageForProfile } from '../src/renderer/src/i18n'
import { englishMessages } from '../src/renderer/src/translations'
import { emptyState, type Command, type InterfaceLanguage, type Keep, type ProfileId, type Result, type State } from '../src/shared/domain'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let container: HTMLDivElement
let state: State
let invoke: ReturnType<typeof vi.fn<(command: Command) => Promise<Result>>>
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks() })
const snapshot = () => ({ interfaceLanguage: state.interfaceLanguage, activeProfile: state.activeProfile, profile: state.activeProfile ? state.profiles[state.activeProfile] : null, ai: { provider: state.ai.provider, configs: {}, ollamaBaseUrl: state.ai.ollamaBaseUrl } })
async function mount(profile: ProfileId | null, populated = false, interfaceLanguage: InterfaceLanguage | null = null) {
  state = emptyState(); state.activeProfile = profile; state.interfaceLanguage = interfaceLanguage
  if (populated) {
    const material = { id: 'material', title: '学习语言', kind: 'text' as const, source: '', fingerprint: 'fixture', chapters: [{ id: 'chapter', title: '原文章节', segmentation: 'ready' as const, blocks: [{ id: 'block', kind: 'paragraph' as const, text: '学习语言。', emphasis: [], tokens: [{ start: 0, end: 2 }, { start: 2, end: 4 }] }] }], createdAt: '' }
    const keep: Keep = { id: 'keep', selection: { materialId: material.id, chapterId: 'chapter', blockId: 'block', spans: [{ start: 0, end: 2 }], combined: false, text: '学习', context: '学习语言。' }, meaning: { text: '学习语言', source: 'manual' }, active: true, level: 1, note: '学习语言', updatedAt: '', meaningUpdatedAt: '', reviews: [], card: { due: '2000-01-01T00:00:00Z', stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, reps: 0, lapses: 0, state: 0, learning_steps: 0 } }
    state.profiles['en-zh'].materials.push(material); state.profiles['en-zh'].keeps.push(keep)
  }
  invoke = vi.fn(async (command: Command): Promise<Result> => {
    if (command.type === 'profile') state.activeProfile = command.profile as ProfileId
    if (command.type === 'interfaceLanguage') state.interfaceLanguage = command.language as InterfaceLanguage | null
    if (command.type === 'lookup') return { meanings: [{ text: '学习语言', source: 'dictionary' }] }
    if (command.type === 'explain') return { error: '请先配置 AI' }
    if (command.type === 'binding') return { meaning: { text: '学习语言', source: 'manual' } }
    return { snapshot: snapshot() }
  })
  window.ling = { invoke, onCloseRequested: () => () => {} }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(<App />))
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label && !button.closest('[hidden]'))
  expect(button, label).toBeDefined(); await act(async () => button!.click())
}
async function choose(name: string, value: string) {
  const trigger = container.querySelector<HTMLButtonElement>(`[role="combobox"][name="${name}"]`)!
  await act(async () => trigger.click())
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.dataset.value === value)
  expect(option).toBeDefined()
  await act(async () => option!.click())
}

test('first launch previews the chosen native language without creating a profile', async () => {
  await mount(null)
  expect(document.documentElement.lang).toBe('zh-CN')
  await choose('native-language', 'en')
  expect(document.documentElement.lang).toBe('en')
  expect(container.querySelector('h1')?.textContent).toContain('Start with your language.')
  expect(container.querySelector('[aria-label="Native language"]')).not.toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Learning language"]')!.click())
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain('Chinese')
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Learning language"]')!.click())
  expect(container.textContent).not.toMatch(/\p{Script=Han}/u)
  expect(invoke).toHaveBeenCalledTimes(1)
  await choose('learning-language', 'zh'); await click('Enter Library →')
  expect(document.documentElement.lang).toBe('en')
  expect(container.querySelector('.onboarding')).toBeNull()
})

test('saved profile restores English throughout Library, import, settings and Keep; draft choices do not change locale', async () => {
  await mount('en-zh')
  expect(document.documentElement.lang).toBe('en')
  expect(container.querySelector('.nav-caption')).toBeNull()
  expect(container.querySelector('.empty h2')?.textContent).toBe('Start with something you want to read')
  await click('＋ Import material')
  expect(container.querySelector('[aria-label="Import material"]')).not.toBeNull()
  expect(container.querySelector('textarea')?.placeholder).toBe('Paste what you want to read here…')
  expect(container.textContent).not.toMatch(/\p{Script=Han}/u)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close import"]')!.click())
  await click('Setting')
  expect(container.querySelector('[aria-label="Model provider"]')).not.toBeNull()
  expect(container.querySelector('[aria-label="Google Gemini API key"]')).not.toBeNull()
  expect(container.textContent).not.toMatch(/\p{Script=Han}/u)
  invoke.mockResolvedValueOnce({ error: '输入数据无效，请检查后重试' })
  await click('Save settings')
  expect(container.querySelector('[role="status"]')?.textContent).toBe('Invalid input. Check your entries and retry.')
  await click('Learning language'); await click('Choose again'); await choose('native-language', 'zh'); await choose('learning-language', 'en')
  expect(document.documentElement.lang).toBe('en')
  await click('Save languages')
  expect(document.documentElement.lang).toBe('zh-CN')
  expect(container.querySelector('h1')?.textContent).toBe('资料库')
  await act(async () => root!.unmount()); root = createRoot(container)
  await act(async () => root!.render(<App />))
  expect(document.documentElement.lang).toBe('zh-CN')
  expect(container.querySelector('.nav-caption')).toBeNull()
})

test('reader, contextual meanings, notes and review controls use native English without translating learning content', async () => {
  await mount('en-zh', true)
  await act(async () => container.querySelector<HTMLButtonElement>('.cover')!.click())
  expect(container.querySelector('[aria-label="Reading material"]')).not.toBeNull()
  expect(container.querySelector('.reader-content')?.textContent).toContain('学习语言。')
  expect(container.textContent).toContain('Combine words')
  await act(async () => container.querySelector<HTMLSpanElement>('[data-start="0"]')!.click())
  expect(container.querySelector('.meaning-sidebar .notice')?.textContent).toContain('Configure AI first')
  expect(container.querySelectorAll('.candidate-section')).toHaveLength(1)
  expect(container.querySelector('.candidate-section h3')?.textContent).toBe('Meanings')
  expect(container.querySelector('.candidate-section')?.textContent).toContain('学习语言')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Contextual meaning"]')?.value).toBe('学习语言')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Keep notes"]')?.value).toBe('学习语言')
  await click('Setting'); await click('Back')
  expect(container.querySelector('.meaning-sidebar h2')?.textContent).toBe('学习')
  await click('Keep1')
  expect(container.querySelector('.keep-detail')?.textContent).not.toContain('Next review')
  expect(container.querySelector('.keep-detail')?.textContent).not.toContain('Reviewed 0 times')
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Keep meaning"]')?.value).toBe('学习语言')
  await click('Start review · 1 due'); await click('Show meaning')
  expect(container.querySelector('.review-meaning')?.textContent).toBe('学习语言')
  expect([...container.querySelectorAll('.review-grades button')].map(button => button.textContent)).toEqual(['Again', 'Hard', 'Good'])
  await click('Good'); expect(container.querySelector('.empty h1')?.textContent).toBe('Review complete')
})

test('error/status templates retain details and unknown diagnostics; locales follow native language', () => {
  expect(languageForProfile('zh-en')).toBe('zh'); expect(languageForProfile('en-zh')).toBe('en')
  expect(languageForProfile('zh-fr')).toBe('zh'); expect(languageForProfile('en-fr')).toBe('en')
  expect(translate('en', '法语')).toBe('French')
  expect(translate('en', '保存失败：本地词库暂不可用，请重试')).toBe('Save failed: The local dictionary is unavailable. Please retry.')
  expect(translate('en', '保存失败：disk full；输入已保留，请返回原内容重试保存。')).toContain('Save failed: disk full; your input is preserved.')
  expect(translate('en', 'OpenAI 请求失败（HTTP 401），请检查密钥与访问权限')).toBe('OpenAI request failed (HTTP 401); check the key and access permissions')
  expect(translate('en', '无法连接 Ollama（本地），请检查地址、网络或超时后重试')).toContain('Could not connect to Ollama (local)')
  expect(translate('en', '下载失败（HTTP 503）')).toBe('Download failed (HTTP 503)')
  expect(translate('en', 'EPUB 缺少章节或资源：chapter.xhtml')).toContain('chapter.xhtml')
  expect(translate('en', 'Unexpected diagnostic 123')).toBe('Unexpected diagnostic 123')
  expect(translate('en', 'constructor')).toBe('constructor')
  expect(translate('en', '{constructor}')).toBe('{constructor}')
  expect(translate('en', '已保存')).toBe('Saved')
  expect(translate('zh', '保存失败：disk full')).toBe('保存失败：disk full')
})

test('every Chinese interface key has an English translation and no Chinese JSX text remains', () => {
  const missing: string[] = []
  for (const file of readdirSync('src/renderer/src').filter(file => file.endsWith('.tsx') && file !== 'i18n.tsx')) {
    const tree = ts.createSourceFile(file, readFileSync(`src/renderer/src/${file}`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node: ts.Node) {
      if (ts.isJsxText(node) && /\p{Script=Han}/u.test(node.text)) missing.push(`${file}: untranslated JSX ${node.text}`)
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text.trim()
        if (/\p{Script=Han}/u.test(key) && !englishMessages[key]) missing.push(`${file}: ${key}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  expect(missing).toEqual([])
})


test('Keep remains a proper name in Chinese and English interface labels', async () => {
  for (const key of ['Keep', '返回 Keep', '← 返回 Keep', 'Keep 笔记', 'Keep 释义', '搜索 Keep']) {
    expect(translate('zh', key)).toBe(key)
    expect(translate('en', key)).toContain('Keep')
  }
  await mount('zh-en')
  const keepButton = [...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button => button.textContent === 'Keep0')
  expect(keepButton).toBeDefined()
  await act(async () => keepButton!.click())
  expect(container.querySelector('h1')?.textContent).toBe('Keep')
  expect(container.querySelector('[aria-label="搜索 Keep"]')).not.toBeNull()
})

test('independent interface language survives profile switches and restart, with native-language reset', async () => {
  await mount('zh-en')
  await click('设置'); await click('界面语言')
  await choose('interface-language', 'en')
  expect(document.documentElement.lang).toBe('zh-CN')
  await click('保存设置')
  expect(document.documentElement.lang).toBe('en')
  expect(state.activeProfile).toBe('zh-en')
  expect(state.interfaceLanguage).toBe('en')
  expect(invoke).toHaveBeenLastCalledWith({ type: 'interfaceLanguage', language: 'en' })
  for (const [native, learning] of [['en', 'zh'], ['zh', 'en']]) {
    await click('Learning language'); await click('Choose again')
    await choose('native-language', native); await choose('learning-language', learning)
    await click('Save languages')
    expect(document.documentElement.lang).toBe('en')
    await click('Setting')
  }
  await act(async () => root!.unmount()); root = createRoot(container)
  await act(async () => root!.render(<App />))
  expect(document.documentElement.lang).toBe('en')
  await click('Setting'); await click('Interface language')
  await choose('interface-language', 'native'); await click('Save settings')
  expect(document.documentElement.lang).toBe('zh-CN')
  expect(state.interfaceLanguage).toBeNull()
})
test('failed interface-language save keeps the original locale and draft; pending save locks controls', async () => {
  await mount('zh-en')
  await click('设置'); await click('界面语言'); await choose('interface-language', 'en')
  let reject!: (reason: Error) => void
  invoke.mockImplementationOnce(() => new Promise<Result>((_, fail) => { reject = fail }))
  await click('保存设置')
  expect(container.querySelector<HTMLButtonElement>('[name="interface-language"]')!.disabled).toBe(true)
  expect(container.querySelector<HTMLButtonElement>('.interface-language-settings button[type="submit"]')!.disabled).toBe(true)
  await act(async () => reject(new Error('disk full')))
  expect(document.documentElement.lang).toBe('zh-CN')
  expect(state.interfaceLanguage).toBeNull()
  expect(container.querySelector<HTMLButtonElement>('[name="interface-language"]')!.value).toBe('en')
  expect(container.querySelector('.interface-language-settings [role="status"]')?.textContent).toBe('disk full')
  await click('保存设置')
  expect(document.documentElement.lang).toBe('en')
})
test('saved interface language overrides native language on startup and first-launch preview', async () => {
  await mount('en-zh', false, 'zh')
  expect(document.documentElement.lang).toBe('zh-CN')
  await act(async () => root!.unmount()); root = undefined
  await mount(null, false, 'en')
  await choose('native-language', 'zh')
  expect(document.documentElement.lang).toBe('en')
})
