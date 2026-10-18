import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store'
import { Learning, defaultMeaning } from '../src/main/learning'
import { importText } from '../src/main/imports'
import { makeSelection, highlights, adjustBoundaries } from '../src/shared/reading'

test('separate contexts, idempotent status, ignore/restore and source deletion preserve notes and FSRS', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-keep-'))
  try {
    const store = new Store(join(directory, 'data.json')); const learning = new Learning(store)
    const material = importText('Bank bank. The bank.', '', 'zh-en')
    await learning.addMaterial('zh-en', material)
    const first = makeSelection(material.id, material.chapters[0], [{ start: 0, end: 4 }])
    const second = makeSelection(material.id, material.chapters[0], [{ start: 5, end: 9 }])
    await expect(learning.status('zh-en', first, 1)).rejects.toThrow('释义')
    await learning.bind('zh-en', first, { text: '银行', source: 'manual' })
    expect((await store.read()).profiles['zh-en'].keeps).toHaveLength(0)
    await learning.status('zh-en', first, 1)
    await learning.status('zh-en', first, 4)
    await learning.status('zh-en', second, 2)
    let keeps = (await store.read()).profiles['zh-en'].keeps
    expect(keeps).toHaveLength(2)
    expect(keeps[0].card.reps).toBe(0)
    const originalDue = keeps[0].card.due
    await learning.editKeep('zh-en', keeps[0].id, { note: '**remember**' })
    await learning.status('zh-en', first, 0)
    await learning.status('zh-en', first, 5)
    keeps = (await store.read()).profiles['zh-en'].keeps
    expect(keeps[0].note).toBe('**remember**'); expect(keeps[0].card.due).toBe(originalDue)
    expect(keeps[1].level).toBe(2)
    expect(highlights(material.chapters[0], material.id, keeps, 'en')).toHaveLength(3)
    await learning.removeMaterial('zh-en', material.id)
    expect((await store.read()).profiles['zh-en'].keeps).toHaveLength(2)
    expect((await store.read()).profiles['en-zh'].keeps).toHaveLength(0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('sentence context, discontinuous positions, cross-paragraph selection and local-only combination highlighting', () => {
  const material = importText('I want you to drive.\n\nI want to go.', '', 'zh-en')
  const chapter = material.chapters[0]
  const selection = makeSelection(material.id, chapter, [{ start: 2, end: 6 }, { start: 11, end: 13 }], true)
  expect(selection.text).toBe('want … to'); expect(selection.context).toBe('I want you to drive.')
  const keep = { selection, active: true } as Parameters<typeof highlights>[2][number]
  expect(highlights(chapter, material.id, [keep], 'en')).toEqual(selection.spans)
  expect(highlights(chapter, 'other', [keep], 'en')).toEqual([])
  expect(makeSelection(material.id, chapter, [{ start: 15, end: 26 }]).context).toContain('I want to go.')
})
test('Chinese corrections preserve text and existing absolute positions', () => {
  const block = { id: 'b', kind: 'paragraph', text: '我爱学习', emphasis: [], tokens: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 4 }] } as const
  const mutable = structuredClone(block) as unknown as Parameters<typeof adjustBoundaries>[0]
  expect(adjustBoundaries(mutable, { start: 0, end: 2 }, false)).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }])
  expect(adjustBoundaries(mutable, { start: 2, end: 4 }, true)).toHaveLength(4)
  expect(mutable.text).toBe('我爱学习')
})
test('recent saved meaning follows meaning edits, not note edits or review activity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-meaning-history-'))
  try {
    const store = new Store(join(directory, 'state.json')); const learning = new Learning(store)
    const material = importText('bank bank bank.', '', 'zh-en'); const chapter = material.chapters[0]
    await learning.addMaterial('zh-en', material)
    await learning.status('zh-en', makeSelection(material.id, chapter, [{ start: 0, end: 4 }]), 1, { text: '银行', source: 'manual' })
    await learning.status('zh-en', makeSelection(material.id, chapter, [{ start: 5, end: 9 }]), 1, { text: '河岸', source: 'manual' })
    await store.update(state => {
      const keeps = state.profiles['zh-en'].keeps
      keeps[0].meaningUpdatedAt = '2026-01-01T00:00:00.000Z'; keeps[1].meaningUpdatedAt = '2026-01-02T00:00:00.000Z'
    })
    const first = (await store.read()).profiles['zh-en'].keeps[0]
    await learning.editKeep('zh-en', first.id, { note: 'A new note' })
    const selection = makeSelection(material.id, chapter, [{ start: 10, end: 14 }])
    expect(defaultMeaning(await store.read(), 'zh-en', selection)?.text).toBe('河岸')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('paginated progress persists absolute word anchors and rejects positions outside their block', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-pagination-'))
  try {
    const store = new Store(join(directory, 'data.json')); const learning = new Learning(store)
    const material = importText('First paragraph.\n\nSecond paragraph.', '', 'zh-en')
    await learning.addMaterial('zh-en', material)
    const chapter = material.chapters[0]
    const progress = { chapterId: chapter.id, blockId: chapter.blocks[1].id, offset: 0, textOffset: 18 }
    await learning.progress('zh-en', material.id, progress)
    expect((await new Store(join(directory, 'data.json')).read()).profiles['zh-en'].materials[0].progress).toEqual(progress)
    await expect(learning.progress('zh-en', material.id, { ...progress, textOffset: 0 })).rejects.toThrow('阅读位置无效')
    await expect(learning.progress('zh-en', material.id, { ...progress, textOffset: 999 })).rejects.toThrow('阅读位置无效')
    await learning.progress('zh-en', material.id, { chapterId: chapter.id, blockId: chapter.blocks[0].id, offset: 24 })
    expect((await store.read()).profiles['zh-en'].materials[0].progress?.offset).toBe(24)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
