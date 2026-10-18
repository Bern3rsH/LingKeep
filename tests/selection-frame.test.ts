import { expect, test } from 'vitest'
import { selectionFrames, visibleSelectionBounds } from '../src/renderer/src/SelectionFrame'

const viewport = { left: 100, top: 50, right: 500, bottom: 350 }
test('multiple words and wrapped lines share one enclosing selection rectangle', () => {
  expect(visibleSelectionBounds([
    { left: 130, top: 80, right: 180, bottom: 100 },
    { left: 190, top: 80, right: 450, bottom: 100 },
    { left: 120, top: 120, right: 220, bottom: 140 }
  ], viewport)).toEqual({ left: 120, top: 80, right: 450, bottom: 140 })
})
test('off-page fragments do not enlarge the frame and partial fragments are clipped', () => {
  expect(visibleSelectionBounds([
    { left: -200, top: 80, right: 50, bottom: 100 },
    { left: 90, top: 40, right: 180, bottom: 100 },
    { left: 450, top: 320, right: 600, bottom: 370 },
    { left: 700, top: 80, right: 800, bottom: 100 }
  ], viewport)).toEqual(viewport)
})
test('empty, zero-width and fully off-page selections do not create a frame', () => {
  expect(visibleSelectionBounds([], viewport)).toBeUndefined()
  expect(visibleSelectionBounds([{ left: 120, top: 80, right: 120, bottom: 100 }, { left: 600, top: 80, right: 700, bottom: 100 }], viewport)).toBeUndefined()
})

const words = ['Judith', 'looked', 'up', 'at', 'her'].flatMap((text, index) => [
  { text, selected: index !== 1, rects: [{ left: 120 + index * 60, top: 80, right: 170 + index * 60, bottom: 100 }] },
  { text: ' ', selected: false, rects: [] }
])
test('combined selection frames word 1 and words 3/4/5 separately, excluding word 2', () => {
  const frames = selectionFrames(words, true, viewport)
  expect(frames).toEqual([
    { left: 120, top: 80, right: 170, bottom: 100 },
    { left: 240, top: 80, right: 410, bottom: 100 }
  ])
  const skipped = words[2].rects[0]
  expect(frames.every(frame => frame.right <= skipped.left || frame.left >= skipped.right)).toBe(true)
})
test('adjacent selected words and split emphasis elements share one frame across whitespace', () => {
  expect(selectionFrames(words.map(word => ({ ...word, selected: Boolean(word.text.trim()) })), true, viewport)).toEqual([
    { left: 120, top: 80, right: 410, bottom: 100 }
  ])
  expect(selectionFrames([{ text: 'Ju', selected: true, rects: [{ left: 120, top: 80, right: 140, bottom: 100 }] }, { text: 'dith', selected: true, rects: [{ left: 140, top: 80, right: 170, bottom: 100 }] }], true, viewport)).toHaveLength(1)
})
test('each combined frame clips independently and disappears when fully off page', () => {
  expect(selectionFrames(words, true, { ...viewport, left: 200, right: 280 })).toEqual([
    { left: 240, top: 80, right: 280, bottom: 100 }
  ])
  expect(selectionFrames(words, true, { left: 600, top: 50, right: 700, bottom: 350 })).toEqual([])
  expect(selectionFrames([], true, viewport)).toEqual([])
})
test('ordinary selection retains its single enclosing frame', () => {
  expect(selectionFrames(words, false, viewport)).toEqual([{ left: 120, top: 80, right: 410, bottom: 100 }])
})
