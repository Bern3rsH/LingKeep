import { expect, test } from 'vitest'
import { Dictionaries } from '../src/main/dictionary'
import { resolve } from 'node:path'
import { englishMeanings } from '../src/shared/dictionary-format'

test('dictionary senses are selectable individually and keep part of speech and qualifiers', () => {
  expect(englishMeanings('n. 银行, 堤, 岸\\n[医] 库')).toEqual(['n. 银行', 'n. 堤', 'n. 岸', '[医] 库'])
  expect(englishMeanings('v. 学习(技巧, 知识), 研究')).toEqual(['v. 学习(技巧, 知识)', 'v. 研究'])
})

test('bundled real dictionaries work offline in both directions and handle word forms', async () => {
  const dictionaries = new Dictionaries(resolve('resources/dictionaries'))
  expect((await dictionaries.lookup('Bank', 'zh-en')).some(meaning => meaning.text.includes('银行'))).toBe(true)
  expect((await dictionaries.lookup('drove', 'zh-en')).length).toBeGreaterThan(0)
  expect((await dictionaries.lookup('children', 'zh-en')).length).toBeGreaterThan(0)
  expect((await dictionaries.lookup('学习', 'en-zh')).some(meaning => /study|learn/.test(meaning.text))).toBe(true)
  expect(await dictionaries.lookup('no such unusual sentence xyzzy.', 'zh-en')).toEqual([])
}, 15_000)
test('unavailable dictionaries fail visibly and remain retryable', async () => {
  const dictionaries = new Dictionaries('/private/tmp/ling-no-dictionary')
  await expect(dictionaries.lookup('bank', 'zh-en')).rejects.toThrow('本地词库暂不可用')
  await expect(dictionaries.lookup('bank', 'zh-en')).rejects.toThrow('本地词库暂不可用')
})
test.each(['zh-fr', 'en-fr'] as const)('French %s returns no offline senses without loading a Chinese/English dictionary', async profile => {
  const dictionaries = new Dictionaries('/private/tmp/ling-no-dictionary')
  expect(await dictionaries.lookup('étaient', profile)).toEqual([])
  expect(await dictionaries.lookup('chat', profile)).toEqual([])
})
