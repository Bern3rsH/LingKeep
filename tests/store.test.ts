import { afterEach, expect, test } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyState } from '../src/shared/domain'
import { Store } from '../src/main/store'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture() { const directory = await mkdtemp(join(tmpdir(), 'ling-store-')); directories.push(directory); return new Store(join(directory, 'state.json')) }
test('legacy two-language data gains isolated French profiles without changing original content or settings', async () => {
  const store = await fixture()
  const state = emptyState()
  state.activeProfile = 'zh-en'
  state.profiles['zh-en'].contextNotes['saved-note'] = 'Preserve original note'
  const legacy = { ...state, profiles: { 'zh-en': state.profiles['zh-en'], 'en-zh': state.profiles['en-zh'] } }
  await writeFile(store.path, JSON.stringify(legacy))
  const loaded = await store.read()
  expect(loaded.profiles['zh-en']).toEqual(legacy.profiles['zh-en'])
  expect(loaded.profiles['en-zh']).toEqual(legacy.profiles['en-zh'])
  expect(loaded.ai).toEqual(legacy.ai)
  expect(loaded.profiles['zh-fr']).toEqual(emptyState().profiles['zh-fr'])
  expect(loaded.profiles['en-fr']).toEqual(emptyState().profiles['en-fr'])
  await store.update(current => { current.activeProfile = 'zh-fr'; current.profiles['zh-fr'].contextNotes['french'] = 'French note' })
  const reloaded = await new Store(store.path).read()
  expect(reloaded.activeProfile).toBe('zh-fr')
  expect(reloaded.profiles['zh-fr'].contextNotes['french']).toBe('French note')
  expect(reloaded.profiles['en-fr'].contextNotes).toEqual({})
  expect(reloaded.profiles['zh-en']).toEqual(legacy.profiles['zh-en'])
})
test('serializes updates and isolates language users', async () => {
  const store = await fixture()
  await Promise.all(Array.from({ length: 15 }, (_, i) => store.update(state => { state.profiles['zh-en'].bindings[String(i)] = { text: String(i), source: 'manual' } })))
  const state = await store.read()
  expect(Object.keys(state.profiles['zh-en'].bindings)).toHaveLength(15)
  expect(state.profiles['en-zh'].bindings).toEqual({})
})
test('recovers a corrupt file from backup and preserves bytes', async () => {
  const store = await fixture()
  await store.update(state => { state.activeProfile = 'zh-en' })
  await store.update(state => { state.activeProfile = 'en-zh' })
  await writeFile(store.path, 'broken')
  expect((await store.read()).activeProfile).toBe('zh-en')
  const files = await readdir(join(store.path, '..'))
  const preserved = files.find(file => file.includes('.corrupt-'))!
  expect(await readFile(join(store.path, '..', preserved), 'utf8')).toBe('broken')
})
test('rejects unrecoverable corruption without default reset; failed mutation is not committed', async () => {
  const store = await fixture()
  await writeFile(store.path, '{')
  await expect(store.read()).rejects.toThrow('未重置')
  await rm(store.path)
  await expect(store.update(state => { state.activeProfile = 'en-zh'; throw new Error('abort') })).rejects.toThrow('abort')
  expect((await store.read()).activeProfile).toBeNull()
})

test('legacy data without an interface-language preference defaults to native language', async () => {
  const store = await fixture()
  const { interfaceLanguage: _preference, ...legacy } = emptyState()
  legacy.activeProfile = 'en-zh'
  await writeFile(store.path, JSON.stringify(legacy))
  const loaded = await store.read()
  expect(loaded.interfaceLanguage).toBeNull()
  expect(loaded.activeProfile).toBe('en-zh')
  expect(loaded.profiles).toEqual(legacy.profiles)
})

test('old language profiles without context-note drafts gain empty note maps', async () => {
  const store = await fixture()
  const legacy = JSON.parse(JSON.stringify(emptyState()))
  delete legacy.profiles['zh-en'].contextNotes
  delete legacy.profiles['en-zh'].contextNotes
  await writeFile(store.path, JSON.stringify(legacy))
  const loaded = await store.read()
  expect(loaded.profiles['zh-en'].contextNotes).toEqual({})
  expect(loaded.profiles['en-zh'].contextNotes).toEqual({})
})
