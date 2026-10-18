import { expect, test } from 'vitest'
import { expandSelectionToWords, makeSelection, wordSpans } from '../src/shared/reading'
import type { Chapter } from '../src/shared/domain'

const chapter = (texts: string[]): Chapter => ({ id: 'chapter', title: '', segmentation: 'ready', blocks: texts.map((text, index) => ({ id: `block-${index}`, kind: 'paragraph', text, emphasis: [], tokens: [] })) })
test('French accented words and elision remain whole during word and drag selection', () => {
  const text = 'L’école était très belle. Ils étaient heureux.'
  const words = wordSpans(text, 'fr')
  expect(words.map(span => text.slice(span.start, span.end))).toEqual(['L’école', 'était', 'très', 'belle', 'Ils', 'étaient', 'heureux'])
  const book = chapter([text])
  expect(expandSelectionToWords(book, { start: 2, end: 5 }, 'fr')).toEqual({ start: 0, end: 7 })
  const selection = makeSelection('french', book, [{ start: 30, end: 37 }], false, 'fr')
  expect(selection.text).toBe('étaient')
  expect(selection.context).toBe('Ils étaient heureux.')
})
test('partial endpoints expand to complete words, including a partial single word', () => {
  const book = chapter(['Hello wonderful world.'])
  expect(expandSelectionToWords(book, { start: 2, end: 19 }, 'en')).toEqual({ start: 0, end: 21 })
  const span = expandSelectionToWords(book, { start: 8, end: 10 }, 'en')
  expect(span).toEqual({ start: 6, end: 15 })
  expect(makeSelection('book', book, [span]).text).toBe('wonderful')
})
test('exact boundaries, whitespace and punctuation do not pull in adjacent words', () => {
  const book = chapter(['Hello, world!'])
  expect(expandSelectionToWords(book, { start: 0, end: 5 }, 'en')).toEqual({ start: 0, end: 5 })
  expect(expandSelectionToWords(book, { start: 5, end: 7 }, 'en')).toEqual({ start: 5, end: 7 })
  expect(expandSelectionToWords(book, { start: 7, end: 12 }, 'en')).toEqual({ start: 7, end: 12 })
})
test('cross-paragraph endpoints retain absolute offsets', () => {
  const book = chapter(['Hello world', 'Another chapter'])
  const span = expandSelectionToWords(book, { start: 8, end: 16 }, 'en')
  expect(span).toEqual({ start: 6, end: 20 })
  expect(makeSelection('book', book, [span]).text).toBe('world\n\nAnother')
})
test('Chinese selection uses the existing corrected word tokens', () => {
  const book = chapter(['学习中文词语'])
  book.blocks[0].tokens = [{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }]
  expect(expandSelectionToWords(book, { start: 1, end: 3 }, 'zh')).toEqual({ start: 0, end: 4 })
  expect(expandSelectionToWords(book, { start: 2, end: 4 }, 'zh')).toEqual({ start: 2, end: 4 })
})
test('invalid or empty ranges are rejected without changing the chapter', () => {
  const book = chapter(['Hello'])
  expect(() => expandSelectionToWords(book, { start: 3, end: 2 }, 'en')).toThrow()
  expect(() => expandSelectionToWords(book, { start: 0, end: 6 }, 'en')).toThrow()
  expect(() => expandSelectionToWords(chapter([]), { start: 0, end: 1 }, 'en')).toThrow()
  expect(book.blocks[0].text).toBe('Hello')
})
