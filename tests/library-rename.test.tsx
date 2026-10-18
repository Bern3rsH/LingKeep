// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { Library } from '../src/renderer/src/Library'
import { emptyState, type Material, type Result } from '../src/shared/domain'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const material: Material = { id: 'epub-book', kind: 'epub', title: 'Original EPUB', source: 'book.epub', fingerprint: 'fingerprint', createdAt: '', chapters: [] }
let root: Root
let container: HTMLDivElement
const invoke = vi.fn<() => Promise<Result>>()
const apply = vi.fn()
function renamed(title = 'Renamed EPUB'): Result {
  return { snapshot: { activeProfile: 'zh-en', profile: { ...emptyState().profiles['zh-en'], materials: [{ ...material, title }] }, ai: { provider: 'ollama', configs: {}, ollamaBaseUrl: 'http://127.0.0.1:11434' } } }
}
function TestLibrary({ initialMaterial = material }: { initialMaterial?: Material }) {
  const [materials, setMaterials] = useState([initialMaterial])
  return <Library profileId="zh-en" materials={materials} apply={result => { apply(result); if (result.snapshot?.profile) setMaterials(result.snapshot.profile.materials) }} open={() => {}} report={() => {}} />
}
async function mount() {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  window.ling = { invoke, onCloseRequested: () => () => {} }
  invoke.mockResolvedValue(renamed())
  await act(async () => root.render(<TestLibrary />))
  await click('重命名')
}
async function click(text: string) {
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === text)!.click())
}
async function type(title: string) {
  await act(async () => {
    const input = container.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, title)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  document.body.replaceChildren(); vi.restoreAllMocks(); invoke.mockReset(); apply.mockClear()
})

test('EPUB rename opens an app dialog without prompt, preselects title and updates the card after save', async () => {
  const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('prompt() is not supported.') })
  await mount()
  expect(container.querySelector('[role="dialog"][aria-label="重命名"]')).not.toBeNull()
  const input = container.querySelector('input')!
  expect(document.activeElement).toBe(input)
  expect(input.value).toBe(material.title)
  expect(input.selectionEnd! - input.selectionStart!).toBe(material.title.length)
  await type('  Renamed EPUB  ')
  await submit()
  expect(invoke).toHaveBeenCalledExactlyOnceWith({ type: 'rename', profile: 'zh-en', materialId: material.id, title: 'Renamed EPUB' })
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(container.querySelector('.material-title')?.textContent).toBe('Renamed EPUB')
  expect(prompt).not.toHaveBeenCalled()
})
test('cancel and Escape discard edits, while blank titles cannot be saved', async () => {
  await mount(); await type('Discard'); await click('取消')
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  await click('重命名')
  expect(container.querySelector('input')?.value).toBe(material.title)
  await type('   ')
  expect(container.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(true)
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('标题不能为空')
  await act(async () => container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})
test('failed rename retains input and retries successfully', async () => {
  await mount(); await type('Renamed EPUB')
  invoke.mockResolvedValueOnce({ error: 'disk full' })
  await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('disk full')
  expect(container.querySelector('input')?.value).toBe('Renamed EPUB')
  expect(container.querySelector('.material-title')?.textContent).toBe(material.title)
  expect(apply).not.toHaveBeenCalled()
  await submit()
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(container.querySelector('.material-title')?.textContent).toBe('Renamed EPUB')
})
test('saving blocks duplicate submissions and cancellation until the request finishes', async () => {
  await mount(); await type('Renamed EPUB')
  let resolve!: (result: Result) => void
  invoke.mockImplementationOnce(() => new Promise(resolveSave => { resolve = resolveSave }))
  await submit(); await submit()
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(container.querySelector('input')?.disabled).toBe(true)
  expect([...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].every(button => button.disabled)).toBe(true)
  await act(async () => container.querySelector('form')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(container.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => resolve(renamed()))
  expect(container.querySelector('[role="dialog"]')).toBeNull()
})

test('EPUB cards display local covers and fall back to the title when the image cannot load', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const cover = `${'a'.repeat(64)}.png`
  await act(async () => root.render(<TestLibrary initialMaterial={{ ...material, cover }} />))
  const image = container.querySelector('.cover img')!
  expect(image.getAttribute('src')).toBe(`ling-asset://local/${cover}`)
  expect(image.closest('button')?.getAttribute('aria-label')).toBe(material.title)
  await act(async () => image.dispatchEvent(new Event('error')))
  expect(container.querySelector('.cover img')).toBeNull()
  expect(container.querySelector('.cover strong')?.textContent).toBe(material.title)
  expect(container.querySelector('.material-title')?.textContent).toBe(material.title)
})
