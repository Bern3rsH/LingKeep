import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Application } from '../src/main/application'
import { Store } from '../src/main/store'
import { Importer } from '../src/main/imports'
import { AI } from '../src/main/ai'
import { Dictionaries } from '../src/main/dictionary'
import { makeSelection } from '../src/shared/reading'
import { Reviews } from '../src/main/review'
import { selectionKey } from '../src/shared/domain'
import { regenerateNoteDraft } from '../src/shared/note'

const directories: string[] = []
async function bulkFixture() {
  const app = await fixture()
  await app.command({ type: 'profile', profile: 'zh-en' })
  const { material } = await importMaterial(app, 'zh-en', 'one two three.')
  for (const [start, end] of [[0, 3], [4, 7], [8, 13]]) {
    const selection = makeSelection(material.id, material.chapters[0], [{ start, end }])
    await app.command({ type: 'status', profile: 'zh-en', selection, level: 2, meaning: { text: `Meaning ${start}`, source: 'manual' } })
  }
  const keeps = (await app.store.read()).profiles['zh-en'].keeps
  await app.command({ type: 'editKeep', profile: 'zh-en', keepId: keeps[0].id, changes: { note: 'Retain my note' } })
  await app.store.update(state => { state.profiles['en-zh'].keeps = structuredClone(state.profiles['zh-en'].keeps) })
  return { app, keeps: (await app.store.read()).profiles['zh-en'].keeps }
}

test('bulk level, remove and restore update selected Keeps atomically while preserving learning data and other profiles', async () => {
  const { app, keeps } = await bulkFixture()
  const original = await app.store.read()
  const keepIds = keeps.slice(0, 2).map(keep => keep.id)
  const update = vi.spyOn(app.store, 'update')
  const result = await app.command({ type: 'batchKeeps', profile: 'zh-en', keepIds: [...keepIds, keepIds[0]], changes: { level: 5, active: true } })
  expect(update).toHaveBeenCalledTimes(1)
  expect(result.snapshot?.profile?.keeps.slice(0, 2).map(keep => keep.level)).toEqual([5, 5])
  await app.command({ type: 'batchKeeps', profile: 'zh-en', keepIds, changes: { active: false } })
  expect((await app.store.read()).profiles['zh-en'].keeps.slice(0, 2).map(keep => keep.active)).toEqual([false, false])
  await app.command({ type: 'batchKeeps', profile: 'zh-en', keepIds, changes: { active: true } })
  const current = await new Store(app.store.path).read()
  for (const [index, keep] of current.profiles['zh-en'].keeps.entries()) {
    expect(keep.card).toEqual(keeps[index].card)
    expect(keep.reviews).toEqual(keeps[index].reviews)
    expect(keep.note).toBe(keeps[index].note)
    expect(keep.selection).toEqual(keeps[index].selection)
    expect(keep.meaning).toEqual(keeps[index].meaning)
    expect(keep.meaningUpdatedAt).toBe(keeps[index].meaningUpdatedAt)
  }
  expect(current.profiles['zh-en'].keeps[2]).toEqual(keeps[2])
  expect(current.profiles['en-zh']).toEqual(original.profiles['en-zh'])
  expect(current.profiles['zh-en'].bindings).toEqual(original.profiles['zh-en'].bindings)
})

test('bulk commands reject invalid or stale selections without partial changes', async () => {
  const { app, keeps } = await bulkFixture()
  const original = await app.store.read()
  for (const command of [
    { type: 'batchKeeps', keepIds: [], changes: { active: false } },
    { type: 'batchKeeps', keepIds: [keeps[0].id], changes: { level: 6 } },
    { type: 'batchKeeps', keepIds: [keeps[0].id], changes: {} },
    { type: 'batchKeeps', keepIds: [keeps[0].id], changes: { note: 'Not a bulk field' } },
    { type: 'batchKeeps', keepIds: [keeps[0].id, 'missing'], changes: { active: false } },
    { type: 'deleteKeeps', keepIds: [] },
    { type: 'deleteKeeps', keepIds: [keeps[0].id, 'missing'] }
  ]) {
    await expect(app.command({ ...command, profile: 'zh-en' })).rejects.toThrow()
    expect(await app.store.read()).toEqual(original)
  }
})

test('permanent bulk deletion removes selected records and their context bindings without changing other data', async () => {
  const { app, keeps } = await bulkFixture()
  const original = await app.store.read()
  const selected = keeps.slice(0, 2)
  const update = vi.spyOn(app.store, 'update')
  await app.command({ type: 'deleteKeeps', profile: 'zh-en', keepIds: [selected[0].id, selected[1].id, selected[0].id] })
  expect(update).toHaveBeenCalledTimes(1)
  const current = await new Store(app.store.path).read()
  expect(current.profiles['zh-en'].keeps).toEqual([keeps[2]])
  for (const keep of selected) expect(current.profiles['zh-en'].bindings[selectionKey(keep.selection)]).toBeUndefined()
  expect(current.profiles['zh-en'].bindings[selectionKey(keeps[2].selection)]).toEqual(keeps[2].meaning)
  expect(current.profiles['zh-en'].materials).toEqual(original.profiles['zh-en'].materials)
  expect(current.profiles['en-zh']).toEqual(original.profiles['en-zh'])
})
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ling-app-')); directories.push(directory)
  return new Application(new Store(join(directory, 'state.json')), new Importer(join(directory, 'assets')), new Dictionaries('resources/dictionaries'), new AI(), async () => undefined, async () => undefined)
}
async function importMaterial(app: Application, profile = 'zh-en', text = 'A bank. River bank.') {
  const preview = await app.command({ type: 'preview', profile, kind: 'text', title: '', input: text })
  const command = { type: 'import', profile, previewId: preview.duplicateId, title: 'Study', blockIds: preview.material!.chapters.flatMap(chapter => chapter.blocks).map(block => block.id), copy: false }
  const saved = await app.command(command)
  return { material: saved.material!, command }
}
test('PDF file picker previews, filters pages, persists and handles duplicates or cancellation', async () => {
  const app = await fixture()
  const picker = vi.spyOn(app, 'chooseFile').mockResolvedValue(join(import.meta.dirname, 'fixtures/pdf/two-pages.pdf'))
  const preview = await app.command({ type: 'preview', profile: 'zh-en', kind: 'pdf', title: 'My PDF', input: '' })
  expect(picker).toHaveBeenCalledWith('pdf')
  expect(preview.material).toMatchObject({ kind: 'pdf', title: 'My PDF', source: 'two-pages.pdf' })
  expect(JSON.stringify(preview)).not.toContain(import.meta.dirname)
  const command = { type: 'import', profile: 'zh-en', previewId: preview.duplicateId, title: 'My PDF', blockIds: preview.material!.chapters[1].blocks.map(block => block.id), copy: false }
  const imported = await app.command(command)
  expect(imported.material!.chapters.map(chapter => chapter.title)).toEqual(['Page 2'])
  const reloaded = await new Store(app.store.path).read()
  expect(reloaded.profiles['zh-en'].materials).toHaveLength(1)
  expect(reloaded.profiles['zh-en'].materials[0].kind).toBe('pdf')
  expect(reloaded.profiles['zh-en'].materials[0].cover).toBeTruthy()
  const duplicate = await app.command({ type: 'preview', profile: 'zh-en', kind: 'pdf', title: '', input: '' })
  expect((await app.command({ ...command, previewId: duplicate.duplicateId, blockIds: duplicate.material!.chapters.flatMap(chapter => chapter.blocks).map(block => block.id) })).duplicateId).toBe(imported.material!.id)
  picker.mockResolvedValue(undefined)
  expect(await app.command({ type: 'preview', profile: 'zh-en', kind: 'pdf', title: '', input: '' })).toEqual({})
  expect((await app.store.read()).profiles['zh-en'].materials).toHaveLength(1)
})
test('URL preview selection uses the first retained image and persists its cover', async () => {
  const app = await fixture()
  const { material } = await importMaterial(app)
  const firstCover = `${'a'.repeat(64)}.png`, secondCover = `${'b'.repeat(64)}.png`
  const article = { ...material, id: 'article', kind: 'url' as const, source: 'https://example.com/article', fingerprint: 'article', cover: firstCover }
  article.chapters[0].blocks.push(...['first', 'second'].map(id => ({ id, kind: 'image' as const, text: '', emphasis: [], tokens: [], image: { source: `https://example.com/${id}.png`, caption: '', asset: id === 'first' ? firstCover : secondCover, missing: false } })))
  vi.spyOn(app.importer, 'web').mockResolvedValue(article)
  const preview = await app.command({ type: 'preview', profile: 'zh-en', kind: 'url', title: '', input: article.source })
  const imported = await app.command({ type: 'import', profile: 'zh-en', previewId: preview.duplicateId, title: 'Article', blockIds: article.chapters[0].blocks.filter(block => block.id !== 'first').map(block => block.id), copy: false })
  expect(imported.material?.cover).toBe(secondCover)
  expect((await new Store(app.store.path).read()).profiles['zh-en'].materials.find(item => item.id === article.id)?.cover).toBe(secondCover)
})
test('existing URL materials recover local covers and successful first-image retries update them', async () => {
  const app = await fixture()
  const { material } = await importMaterial(app)
  const firstCover = `${'a'.repeat(64)}.png`, retriedCover = `${'c'.repeat(64)}.png`
  await app.store.update(state => {
    const saved = state.profiles['zh-en'].materials[0]
    saved.kind = 'url'
    saved.chapters[0].blocks.push({ id: 'image', kind: 'image', text: '', emphasis: [], tokens: [], image: { source: 'https://example.com/first.png', caption: '', asset: firstCover, missing: false } })
  })
  await app.command({ type: 'snapshot' })
  expect((await new Store(app.store.path).read()).profiles['zh-en'].materials[0].cover).toBe(firstCover)
  await app.store.update(state => {
    const saved = state.profiles['zh-en'].materials[0]
    delete saved.cover
    delete saved.chapters[0].blocks.at(-1)!.image!.asset
    saved.chapters[0].blocks.at(-1)!.image!.missing = true
  })
  vi.spyOn(app.importer, 'retryImage').mockImplementation(async block => { block.image!.asset = retriedCover; block.image!.missing = false })
  await app.command({ type: 'images', profile: 'zh-en', materialId: material.id })
  expect((await new Store(app.store.path).read()).profiles['zh-en'].materials[0].cover).toBe(retriedCover)
})
test('AI note sources persist across reload and transfer to Keep; invalid ranges never change saved notes', async () => {
  const app = await fixture()
  const { material } = await importMaterial(app)
  const selection = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 6 }])
  const draft = regenerateNoteDraft({ text: 'Manual', ai: [] }, 'First AI')
  await app.command({ type: 'contextNote', profile: 'zh-en', selection, note: draft.text, noteAI: draft.ai })
  let reloaded = await new Store(app.store.path).read()
  expect(reloaded.profiles['zh-en'].contextNoteAI?.[selectionKey(selection)]).toEqual(draft.ai)
  expect(reloaded.profiles['en-zh'].contextNoteAI).toBeUndefined()
  await app.command({ type: 'selectMeaning', profile: 'zh-en', selection, meaning: { text: '银行', source: 'dictionary' } })
  reloaded = await new Store(app.store.path).read()
  const keep = reloaded.profiles['zh-en'].keeps[0]
  expect(keep.noteAI).toEqual(draft.ai)
  expect(reloaded.profiles['zh-en'].contextNoteAI?.[selectionKey(selection)]).toBeUndefined()
  const next = regenerateNoteDraft({ text: keep.note, ai: keep.noteAI! }, 'Replacement AI')
  await app.command({ type: 'editKeep', profile: 'zh-en', keepId: keep.id, changes: { note: next.text, noteAI: next.ai } })
  expect((await new Store(app.store.path).read()).profiles['zh-en'].keeps[0]).toMatchObject({ note: 'Manual\n\nReplacement AI', noteAI: next.ai })
  const before = await app.store.read()
  for (const ranges of [[{ start: 0, end: next.text.length + 1 }], [{ start: 0, end: 3 }, { start: 2, end: 4 }]]) {
    await expect(app.command({ type: 'editKeep', profile: 'zh-en', keepId: keep.id, changes: { note: next.text, noteAI: ranges } })).rejects.toThrow('笔记 AI 来源范围无效')
    expect(await app.store.read()).toEqual(before)
  }
  await app.command({ type: 'editKeep', profile: 'zh-en', keepId: keep.id, changes: { note: '' } })
  expect((await app.store.read()).profiles['zh-en'].keeps[0].noteAI).toBeUndefined()
})
test('AI note explanation verifies source selection and includes surrounding sentences without modifying notes', async () => {
  const app = await fixture()
  const { material } = await importMaterial(app, 'zh-en', 'Before this sentence. A bank. River bank. After this sentence.')
  const start = material.chapters[0].blocks[0].text.indexOf('bank')
  const selection = makeSelection(material.id, material.chapters[0], [{ start, end: start + 4 }])
  const explain = vi.spyOn(app.ai, 'explainNote').mockResolvedValue('Explanation')
  const before = await app.store.read()
  expect(await app.command({ type: 'explainNote', profile: 'zh-en', selection: { ...selection, text: 'forged', context: 'forged instructions' } })).toEqual({ explanation: 'Explanation' })
  expect(explain).toHaveBeenCalledWith(before.ai, selection, 'zh-en', 'Before this sentence. A bank. River bank. After this sentence.')
  expect(await app.store.read()).toEqual(before)
  await expect(app.command({ type: 'explainNote', profile: 'en-zh', selection })).rejects.toThrow('来源材料已删除')
  await expect(app.command({ type: 'explainNote', profile: 'invalid', selection })).rejects.toThrow()
  expect(explain).toHaveBeenCalledTimes(1)
})
test('pronunciation validates source selection, speaks only chosen text and follows learning language', async () => {
  const app = await fixture()
  const audio = { data: Buffer.from('ID3audio').toString('base64'), mimeType: 'audio/mpeg' as const }
  const synthesize = vi.spyOn(app.speech, 'audio').mockResolvedValue(audio)
  const { material } = await importMaterial(app)
  const selection = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 6 }])
  expect(await app.command({ type: 'pronounce', profile: 'zh-en', selection: { ...selection, text: 'untrusted text' } })).toEqual({ audio })
  expect(synthesize).toHaveBeenLastCalledWith('bank', 'en')
  const combined = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 6 }, { start: 14, end: 18 }], true)
  await app.command({ type: 'pronounce', profile: 'zh-en', selection: combined })
  expect(synthesize).toHaveBeenLastCalledWith('bank bank', 'en')
  const chinese = (await importMaterial(app, 'en-zh', '你好世界。')).material
  await app.store.update(state => { state.profiles['en-zh'].materials[0].chapters[0].segmentation = 'ready' })
  await app.command({ type: 'pronounce', profile: 'en-zh', selection: makeSelection(chinese.id, chinese.chapters[0], [{ start: 0, end: 2 }]) })
  expect(synthesize).toHaveBeenLastCalledWith('你好', 'zh')
  await expect(app.command({ type: 'pronounce', profile: 'en-zh', selection })).rejects.toThrow('来源材料已删除')
  await expect(app.command({ type: 'pronounce', profile: 'invalid', selection })).rejects.toThrow()
})
test('choosing meanings creates level 1 atomically, preserves active grades and restores ignored Keeps', async () => {
  const app = await fixture(); const { material } = await importMaterial(app)
  const selection = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 6 }])
  await app.command({ type: 'contextNote', profile: 'zh-en', selection, note: 'My context' })
  const command = { type: 'selectMeaning', profile: 'zh-en', selection, meaning: { text: '银行', source: 'dictionary' } }
  const before = (await app.store.read()).profiles['zh-en']
  const write = vi.spyOn(app.store as unknown as { write: (...args: unknown[]) => Promise<void> }, 'write').mockRejectedValueOnce(new Error('disk full'))
  await expect(app.command(command)).rejects.toThrow('disk full')
  write.mockRestore()
  expect((await app.store.read()).profiles['zh-en']).toEqual(before)
  await app.command(command)
  const first = (await app.store.read()).profiles['zh-en'].keeps[0]
  expect(first).toMatchObject({ active: true, level: 1, note: 'My context', meaning: command.meaning })
  expect((await app.store.read()).profiles['zh-en'].contextNotes).toEqual({})
  await new Reviews(app.store).grade('zh-en', first.id, 'Good', 'meaning-review')
  await app.learning.editKeep('zh-en', first.id, { level: 4 })
  const reviewed = (await app.store.read()).profiles['zh-en'].keeps[0]
  await app.command({ ...command, meaning: { text: '河岸', source: 'AI' } })
  let keeps = (await app.store.read()).profiles['zh-en'].keeps
  expect(keeps).toHaveLength(1)
  expect(keeps[0]).toMatchObject({ id: first.id, active: true, level: 4, note: first.note, card: reviewed.card, reviews: reviewed.reviews, meaning: { text: '河岸', source: 'AI' } })
  await app.learning.status('zh-en', selection, 0)
  await app.command(command)
  keeps = (await app.store.read()).profiles['zh-en'].keeps
  expect(keeps).toHaveLength(1)
  expect(keeps[0]).toMatchObject({ id: first.id, active: true, level: 1, note: first.note, card: reviewed.card, reviews: reviewed.reviews })
  await expect(app.command({ ...command, meaning: { text: '  ', source: 'AI' } })).rejects.toThrow()
  await expect(app.command({ ...command, profile: 'en-zh' })).rejects.toThrow('来源材料已删除')
  await expect(app.command({ ...command, meaning: { text: '银行', source: 'invalid' } })).rejects.toThrow()
})
test('preview confirmation retries are idempotent; duplicate import requires explicit copy; same titles allowed', async () => {
  const app = await fixture(); await app.command({ type: 'profile', profile: 'zh-en' })
  const first = await importMaterial(app)
  await app.command(first.command)
  const preview = await app.command({ type: 'preview', profile: 'zh-en', kind: 'text', title: 'Study', input: 'A bank. River bank.' })
  const command = { ...first.command, previewId: preview.duplicateId, blockIds: preview.material!.chapters.flatMap(chapter => chapter.blocks).map(block => block.id) }
  expect((await app.command(command)).duplicateId).toBe(first.material.id)
  await app.command({ ...command, copy: true }); await app.command({ ...command, copy: true })
  expect((await app.store.read()).profiles['zh-en'].materials).toHaveLength(2)
  await importMaterial(app, 'en-zh')
  expect((await app.store.read()).profiles['en-zh'].materials).toHaveLength(1)
})
test('Chinese extraction without AI remains pending, failed chapter segmentation preserves successes and retries', async () => {
  const app = await fixture()
  const { material } = await importMaterial(app, 'en-zh', '我爱学习。\n\n今天天气好。')
  await expect(app.command({ type: 'segment', profile: 'en-zh', materialId: material.id })).rejects.toThrow('正文已保存')
  await app.store.update(state => { state.ai.provider = 'ollama'; state.ai.configs.ollama = { key: '', model: 'test' } })
  const segment = vi.spyOn(app.ai, 'segment').mockImplementationOnce(async (_config, text) => [{ start: 0, end: text.length }]).mockRejectedValueOnce(new Error('服务超时'))
  await expect(app.command({ type: 'segment', profile: 'en-zh', materialId: material.id })).rejects.toThrow('超时')
  let chapter = (await app.store.read()).profiles['en-zh'].materials[0].chapters[0]
  expect(chapter.blocks[0].tokens).toHaveLength(1); expect(chapter.segmentation).toBe('pending')
  segment.mockImplementation(async (_config, text) => [{ start: 0, end: text.length }])
  await app.command({ type: 'segment', profile: 'en-zh', materialId: material.id })
  chapter = (await app.store.read()).profiles['en-zh'].materials[0].chapters[0]
  expect(chapter.segmentation).toBe('ready'); expect(segment).toHaveBeenCalledTimes(3)
})
test('IPC rejects malformed inputs; snapshots conceal keys and models without credentials', async () => {
  const app = await fixture()
  await expect(app.command({ type: 'profile', profile: 'invalid' })).rejects.toThrow()
  await expect(app.command({ type: 'openURL', url: 'file:///etc/passwd' })).rejects.toThrow('不支持')
  await app.command({ type: 'settings', provider: 'deepseek', key: 'test-private-key', model: 'unit-test-model', ollamaBaseUrl: 'http://127.0.0.1:11434' })
  expect(JSON.stringify(await app.command({ type: 'snapshot' }))).not.toContain('test-private-key')
  await app.command({ type: 'settings', provider: 'deepseek', removeKey: true, model: 'unit-test-model', ollamaBaseUrl: 'http://127.0.0.1:11434' })
  expect((await app.command({ type: 'snapshot' })).snapshot!.ai.configs.deepseek?.model).toBe('')
})
test('failed FSRS persistence leaves level/card/history intact and retry commits once', async () => {
  const app = await fixture(); const { material } = await importMaterial(app)
  const selection = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 6 }])
  await app.learning.status('zh-en', selection, 4, { text: '银行', source: 'manual' })
  const before = (await app.store.read()).profiles['zh-en'].keeps[0]
  const write = vi.spyOn(app.store as unknown as { write: (...args: unknown[]) => Promise<void> }, 'write').mockRejectedValueOnce(new Error('磁盘写入失败'))
  const reviews = new Reviews(app.store)
  await expect(reviews.grade('zh-en', before.id, 'Again', 'retry-op')).rejects.toThrow('磁盘')
  expect((await app.store.read()).profiles['zh-en'].keeps[0]).toEqual(before)
  write.mockRestore()
  await reviews.grade('zh-en', before.id, 'Again', 'retry-op'); await reviews.grade('zh-en', before.id, 'Again', 'retry-op')
  const after = (await app.store.read()).profiles['zh-en'].keeps[0]
  expect(after.level).toBe(1); expect(after.card.reps).toBe(1); expect(after.reviews).toHaveLength(1)
})

test('interface-language preference is global, persistent and validated without changing learning data or AI', async () => {
  const app = await fixture()
  await app.command({ type: 'profile', profile: 'zh-en' })
  await importMaterial(app)
  const before = await app.store.read()
  expect((await app.command({ type: 'interfaceLanguage', language: 'en' })).snapshot?.interfaceLanguage).toBe('en')
  await app.command({ type: 'profile', profile: 'en-zh' })
  expect((await app.command({ type: 'snapshot' })).snapshot?.interfaceLanguage).toBe('en')
  expect((await new Store(app.store.path).read()).interfaceLanguage).toBe('en')
  expect((await app.store.read()).profiles).toEqual(before.profiles)
  expect((await app.store.read()).ai).toEqual(before.ai)
  await expect(app.command({ type: 'interfaceLanguage', language: 'fr' })).rejects.toThrow()
  expect((await app.store.read()).interfaceLanguage).toBe('en')
  const write = vi.spyOn(app.store as unknown as { write: (...args: unknown[]) => Promise<void> }, 'write').mockRejectedValueOnce(new Error('disk full'))
  await expect(app.command({ type: 'interfaceLanguage', language: 'zh' })).rejects.toThrow('disk full')
  write.mockRestore()
  expect((await app.store.read()).interfaceLanguage).toBe('en')
  expect((await app.command({ type: 'interfaceLanguage', language: null })).snapshot?.interfaceLanguage).toBeNull()
})

test('context notes persist before Keep and promote atomically without touching review history', async () => {
  const app = await fixture()
  const { material } = await importMaterial(app)
  const first = makeSelection(material.id, material.chapters[0], [{ start: 2, end: 6 }])
  const second = makeSelection(material.id, material.chapters[0], [{ start: 14, end: 18 }])
  const note = { type: 'contextNote', profile: 'zh-en', selection: first, note: '**Before Keep**' }
  await app.command(note)
  await app.command({ ...note, selection: second, note: 'Other context' })
  const before = (await new Store(app.store.path).read()).profiles['zh-en']
  expect(before.keeps).toHaveLength(0)
  expect(Object.values(before.contextNotes)).toEqual(['**Before Keep**', 'Other context'])
  expect((await app.store.read()).profiles['en-zh'].contextNotes).toEqual({})
  const status = { type: 'status', profile: 'zh-en', selection: first, level: 1, meaning: { text: '银行', source: 'manual' } }
  const write = vi.spyOn(app.store as unknown as { write: (...args: unknown[]) => Promise<void> }, 'write').mockRejectedValueOnce(new Error('disk full'))
  await expect(app.command(status)).rejects.toThrow('disk full')
  write.mockRestore()
  expect((await app.store.read()).profiles['zh-en'].keeps).toHaveLength(0)
  expect((await app.store.read()).profiles['zh-en'].contextNotes).toEqual(before.contextNotes)
  await app.command(status)
  let profile = (await app.store.read()).profiles['zh-en']
  expect(profile.keeps[0].note).toBe('**Before Keep**')
  expect(Object.values(profile.contextNotes)).toEqual(['Other context'])
  const card = profile.keeps[0].card
  await app.command({ ...note, note: 'A delayed note update' })
  profile = (await app.store.read()).profiles['zh-en']
  expect(profile.keeps[0].note).toBe('A delayed note update')
  expect(profile.keeps[0].card).toEqual(card)
  await app.command({ ...note, selection: second, note: '' })
  expect((await app.store.read()).profiles['zh-en'].contextNotes).toEqual({})
  await expect(app.command({ ...note, profile: 'en-zh' })).rejects.toThrow('来源材料已删除')
})
