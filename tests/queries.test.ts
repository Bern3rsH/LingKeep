import { expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store'
import { AI } from '../src/main/ai'
import { Queries } from '../src/main/queries'
import { Learning } from '../src/main/learning'
import { importText } from '../src/main/imports'
import { cacheKey, selectionKey } from '../src/shared/domain'
import { makeSelection } from '../src/shared/reading'

test('AI caches per context and user, coalesces requests and never overwrites bindings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-query-'))
  try {
    const store = new Store(join(directory, 'state.json'))
    const material = importText('A bank. River bank.', '', 'zh-en')
    await store.update(state => { state.profiles['zh-en'].materials.push(material); state.ai.configs['google-gemini'] = { key: 'x', model: 'test' } })
    const ai = new AI()
    const explain = vi.spyOn(ai, 'explain').mockResolvedValue('银行')
    const queries = new Queries(store, ai)
    const first = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 6 }])
    const second = makeSelection(material.id, material.chapters[0], [{ start: 14, end: 18 }])
    await Promise.all([queries.explain('zh-en', first), queries.explain('zh-en', first)])
    await queries.explain('zh-en', first)
    expect(explain).toHaveBeenCalledTimes(1)
    await queries.explain('zh-en', second)
    expect(explain).toHaveBeenCalledTimes(2)
    expect((await store.read()).profiles['zh-en'].bindings).toEqual({})
    expect((await store.read()).profiles['en-zh'].aiCache).toEqual({})
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test('old AI cache is bypassed without overwriting saved meaning; invalid generations are retryable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-query-format-'))
  try {
    const store = new Store(join(directory, 'state.json'))
    const material = importText('A bank.', '', 'zh-en')
    const selection = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 6 }])
    await store.update(state => {
      state.profiles['zh-en'].materials.push(material)
      state.ai.configs['google-gemini'] = { key: 'x', model: 'test' }
      state.profiles['zh-en'].aiCache[cacheKey(selection)] = { text: 'Old explanation with examples', source: 'AI' }
      state.profiles['zh-en'].bindings[selectionKey(selection)] = { text: 'User-edited meaning', source: 'manual' }
    })
    const ai = new AI()
    const generate = vi.spyOn(ai, 'generate').mockResolvedValueOnce('{"translation":"银行","inflection":null,"partOfSpeech":"n.","extra":"example"}').mockResolvedValue('{"translation":"银行","inflection":null,"partOfSpeech":"n."}')
    const queries = new Queries(store, ai)
    await expect(queries.explain('zh-en', selection)).rejects.toThrow('AI 释义格式无效')
    expect((await queries.explain('zh-en', selection)).text).toBe('n. 银行')
    expect((await queries.explain('zh-en', selection)).text).toBe('n. 银行')
    expect(generate).toHaveBeenCalledTimes(2)
    expect((await store.read()).profiles['zh-en'].bindings[selectionKey(selection)].text).toBe('User-edited meaning')
    await queries.explain('zh-en', selection, true)
    expect(generate).toHaveBeenCalledTimes(3)
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test('inflection details bypass the old cache and survive Keep save without replacing the selected word', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-query-inflection-'))
  try {
    const store = new Store(join(directory, 'state.json'))
    const material = importText('I drove home.', '', 'zh-en')
    const selection = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 7 }])
    await store.update(state => {
      state.profiles['zh-en'].materials.push(material)
      state.ai.configs['google-gemini'] = { key: 'x', model: 'test' }
      state.profiles['zh-en'].aiCache[`native-translation-pos-abbr-v3:${cacheKey(selection)}`] = { text: 'v. 驾驶', source: 'AI' }
    })
    const ai = new AI()
    const generate = vi.spyOn(ai, 'generate').mockResolvedValue('{"translation":"驾驶","partOfSpeech":"v.","inflection":{"baseForm":"drive","change":"过去式"}}')
    const queries = new Queries(store, ai)
    const meaning = await queries.explain('zh-en', selection)
    expect(meaning.text).toBe('v. 驾驶\ndrive → drove（过去式）')
    expect(await queries.explain('zh-en', selection)).toEqual(meaning)
    expect(generate).toHaveBeenCalledTimes(1)
    await new Learning(store).status('zh-en', selection, 1, meaning)
    const saved = (await store.read()).profiles['zh-en']
    expect(saved.keeps[0].selection.text).toBe('drove')
    expect(saved.keeps[0].meaning).toEqual(meaning)
    expect(saved.bindings[selectionKey(selection)]).toEqual(meaning)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
