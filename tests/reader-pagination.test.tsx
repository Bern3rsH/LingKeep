// @vitest-environment jsdom
import { act, useLayoutEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { pageCountForWidth, pageForLeft, useReaderPagination } from '../src/renderer/src/useReaderPagination'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let pagination: ReturnType<typeof useReaderPagination>
let width = 500
let wordStride = 600
let frame: HTMLDivElement
function Fixture({ chapter = 'chapter' }: { chapter?: string }) {
  const viewport = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    frame = viewport.current!
    Object.defineProperty(frame, 'clientWidth', { get: () => width, configurable: true })
    Object.defineProperty(frame, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(frame, 'scrollWidth', { value: 1500, configurable: true })
    frame.getBoundingClientRect = () => ({ left: 0, width } as DOMRect)
    for (const [index, word] of [...frame.querySelectorAll<HTMLElement>('.word')].entries()) {
      word.getClientRects = () => [{ left: index * wordStride - frame.scrollLeft } as DOMRect] as unknown as DOMRectList
    }
  }, [])
  pagination = useReaderPagination(viewport, chapter, true)
  return <div ref={viewport}><div data-block="block">{[0, 10, 20].map(start => <span key={start} className="word" data-start={start} data-end={start + 5}>word</span>)}</div></div>
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); width = 500; wordStride = 600; vi.unstubAllGlobals() })
async function mount() { const container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root!.render(<Fixture />)) }

test('page math handles empty dimensions and fractional trailing pixels', () => {
  expect(pageCountForWidth(0, 0)).toBe(1)
  expect(pageCountForWidth(500, 500)).toBe(1)
  expect(pageCountForWidth(1501, 500)).toBe(3)
  expect(pageForLeft(80, 80, 1000, 500)).toBe(2)
  expect(pageForLeft(-5, 0, 0, 500)).toBe(0)
})
test('page navigation clamps boundaries and returns a stable absolute word anchor', async () => {
  await mount(); expect(pagination.pageCount).toBe(3)
  await act(async () => pagination.showPage(1))
  expect(pagination.page).toBe(1); expect(frame.scrollLeft).toBe(500)
  expect(pagination.location()).toEqual({ blockId: 'block', offset: 0, textOffset: 10 })
  await act(async () => pagination.showPage(99)); expect(pagination.page).toBe(2)
  await act(async () => pagination.showPage(-1)); expect(pagination.page).toBe(0)
})
test('text anchors relocate after resize and chapter changes reset to the first page', async () => {
  await mount()
  await act(async () => pagination.locate('block', 11))
  expect(pagination.page).toBe(1)
  width = 300
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(pagination.pageCount).toBe(5); expect(pagination.page).toBe(2)
  await act(async () => root!.render(<Fixture chapter="next" />))
  expect(pagination.page).toBe(0)
})

test('resize rechecks the anchor after the browser finishes the next layout frame', async () => {
  let nextFrame = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  await mount()
  await act(async () => pagination.locate('block', 10))
  width = 300
  await act(async () => window.dispatchEvent(new Event('resize')))
  expect(pagination.page).toBe(2)
  // Simulate a later browser layout and native scroll adjustment after React's layout effect.
  wordStride = 900
  frame.scrollLeft = 0
  await act(async () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)) })
  expect(pagination.page).toBe(3)
  expect(frame.scrollLeft).toBe(900)
  expect(pagination.location()?.textOffset).toBe(10)
})
