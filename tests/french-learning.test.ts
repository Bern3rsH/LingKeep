import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test, vi } from 'vitest'
import { Application } from '../src/main/application'
import { Store } from '../src/main/store'
import { Importer, importText } from '../src/main/imports'
import { AI } from '../src/main/ai'
import { Dictionaries } from '../src/main/dictionary'
import { highlights, makeSelection } from '../src/shared/reading'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); vi.restoreAllMocks() })
test.each(['zh-fr', 'en-fr'] as const)('French import, AI, pronunciation, Keep, note and review flow stays isolated for %s', async profile => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-french-')); directories.push(directory)
  const ai = new AI()
  const app = new Application(new Store(join(directory, 'state.json')), new Importer(join(directory, 'assets')), new Dictionaries('/private/tmp/no-french-dictionary'), ai, async () => undefined, async () => undefined)
  await app.learning.addMaterial('zh-en', importText('Original English material.', 'Original', 'zh-en'))
  const oldEnglish = (await app.store.read()).profiles['zh-en']
  await app.command({ type: 'settings', provider: 'ollama', model: 'test-model', ollamaBaseUrl: 'http://127.0.0.1:11434' })
  await app.command({ type: 'profile', profile })
  const preview = await app.command({ type: 'preview', profile, kind: 'text', title: 'Français', input: 'L’école était très belle. Ils étaient heureux. Un chat, des chats.' })
  const material = (await app.command({ type: 'import', profile, previewId: preview.duplicateId, title: 'Français', blockIds: preview.material!.chapters.flatMap(chapter => chapter.blocks).map(block => block.id), copy: false })).material!
  expect(material.chapters[0].segmentation).toBe('ready')
  const selection = makeSelection(material.id, material.chapters[0], [{ start: 30, end: 37 }], false, 'fr')
  expect(await app.command({ type: 'lookup', profile, selection })).toEqual({ meanings: [] })
  const translation = profile === 'zh-fr' ? '是（过去）' : 'were'
  const change = profile === 'zh-fr' ? '未完成过去时，第三人称复数' : 'imperfect, third-person plural'
  const generate = vi.spyOn(ai, 'generate').mockResolvedValue(JSON.stringify({ translation, partOfSpeech: 'v.', inflection: { baseForm: 'être', change } }))
  const explained = await app.command({ type: 'explain', profile, selection })
  expect(explained.meaning?.text).toContain('être → étaient')
  await app.command({ type: 'selectMeaning', profile, selection, meaning: explained.meaning })
  const keep = (await app.store.read()).profiles[profile].keeps[0]
  expect(keep.level).toBe(1)
  generate.mockResolvedValueOnce(profile === 'zh-fr' ? 'étaient 是 être 的未完成过去时第三人称复数。' : 'étaient is the imperfect third-person plural form of être.')
  const note = await app.command({ type: 'explainNote', profile, selection })
  await app.command({ type: 'editKeep', profile, keepId: keep.id, changes: { note: note.explanation } })
  const audio = { data: Buffer.from('ID3fixture').toString('base64'), mimeType: 'audio/mpeg' as const }
  const speech = vi.spyOn(app.speech, 'audio').mockResolvedValue(audio)
  expect(await app.command({ type: 'pronounce', profile, selection })).toEqual({ audio })
  expect(speech).toHaveBeenCalledWith('étaient', 'fr')
  await app.command({ type: 'review', profile, keepId: keep.id, rating: 'Good', operationId: randomUUID() })
  const chat = makeSelection(material.id, material.chapters[0], [{ start: 50, end: 54 }], false, 'fr')
  await app.command({ type: 'status', profile, selection: chat, level: 1, meaning: { text: profile === 'zh-fr' ? '猫' : 'cat', source: 'manual' } })
  const state = await new Store(app.store.path).read()
  expect(state.profiles[profile].keeps[0]).toMatchObject({ note: note.explanation, card: { reps: 1 } })
  expect(highlights(material.chapters[0], material.id, [state.profiles[profile].keeps[1]], 'fr')).toEqual([{ start: 50, end: 54 }])
  expect(state.profiles['zh-en']).toEqual(oldEnglish)
  expect(state.profiles[profile === 'zh-fr' ? 'en-fr' : 'zh-fr'].materials).toEqual([])
  const segments = vi.spyOn(ai, 'segment')
  await app.command({ type: 'segment', profile, materialId: material.id })
  expect(segments).not.toHaveBeenCalled()
})
