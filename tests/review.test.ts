import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store'
import { Learning } from '../src/main/learning'
import { Reviews, dueKeeps, nextLevel } from '../src/main/review'
import { importText } from '../src/main/imports'
import { makeSelection } from '../src/shared/reading'

test('grade updates level/card/log atomically, retries once, isolates contexts and preserves manual scheduling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ling-review-'))
  try {
    const store = new Store(join(directory, 'data.json')); const learning = new Learning(store); const reviews = new Reviews(store)
    const material = importText('bank bank.', '', 'zh-en'); const chapter = material.chapters[0]
    await learning.addMaterial('zh-en', material)
    for (const start of [0, 5]) await learning.status('zh-en', makeSelection(material.id, chapter, [{ start, end: start + 4 }]), 5, { text: '银行', source: 'manual' })
    const initial = (await store.read()).profiles['zh-en'].keeps
    expect(dueKeeps(initial)).toHaveLength(2)
    const id = initial[0].id
    await reviews.grade('zh-en', id, 'Hard', 'unique-op')
    await reviews.grade('zh-en', id, 'Hard', 'unique-op')
    let current = (await store.read()).profiles['zh-en'].keeps
    expect(current[0].level).toBe(4); expect(current[0].reviews).toHaveLength(1); expect(current[0].card.reps).toBe(1)
    expect(current[1].level).toBe(5); expect(current[1].card.reps).toBe(0)
    const due = current[0].card.due
    await learning.editKeep('zh-en', id, { level: 1 })
    current = (await store.read()).profiles['zh-en'].keeps
    expect(current[0].card.due).toBe(due)
    await expect(reviews.grade('zh-en', id, 'Good', 'too-early')).rejects.toThrow('尚未到期')
    expect((await store.read()).profiles['zh-en'].keeps[0].reviews).toHaveLength(1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('level boundaries implement Again/Hard/Good independently from numeric FSRS grades', () => {
  expect(nextLevel(5, 'Again')).toBe(1); expect(nextLevel(1, 'Hard')).toBe(1)
  expect(nextLevel(5, 'Hard')).toBe(4); expect(nextLevel(4, 'Good')).toBe(5); expect(nextLevel(5, 'Good')).toBe(5)
})
