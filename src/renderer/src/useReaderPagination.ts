import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export const READER_PAGE_PADDING = 32
export interface PageLocation { blockId: string; offset: number; textOffset?: number }
const PIXEL_TOLERANCE = 1
export function pageCountForWidth(scrollWidth: number, width: number): number { return width > 0 ? Math.max(1, Math.ceil((scrollWidth - PIXEL_TOLERANCE) / width)) : 1 }
export function pageForLeft(left: number, viewportLeft: number, scrollLeft: number, width: number): number { return width > 0 ? Math.max(0, Math.floor((left - viewportLeft + scrollLeft + PIXEL_TOLERANCE) / width)) : 0 }

export function useReaderPagination(viewport: RefObject<HTMLDivElement | null>, chapterId: string, ready: boolean) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [page, setPage] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [revision, setRevision] = useState(0)
  const currentPage = useRef(0)
  const anchor = useRef<PageLocation | undefined>(undefined)
  const count = useRef(1)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  const elementPage = (element: HTMLElement) => {
    const frame = viewport.current
    if (!frame) return 0
    const rect = element.getClientRects()[0] || element.getBoundingClientRect()
    return pageForLeft(rect.left, frame.getBoundingClientRect().left, frame.scrollLeft, frame.clientWidth)
  }
  function location(target = currentPage.current): PageLocation | undefined {
    const frame = viewport.current
    if (!frame) return
    const words = [...frame.querySelectorAll<HTMLElement>('.word[data-start]')]
    let low = 0; let high = words.length
    while (low < high) { const middle = Math.floor((low + high) / 2); if (elementPage(words[middle]) < target) low = middle + 1; else high = middle }
    const word = words[low]
    if (word && elementPage(word) === target) return { blockId: word.closest<HTMLElement>('[data-block]')!.dataset.block!, textOffset: Number(word.dataset.start), offset: 0 }
    const block = [...frame.querySelectorAll<HTMLElement>('[data-block]')].find(element => [...element.getClientRects()].some(rect => pageForLeft(rect.left, frame.getBoundingClientRect().left, frame.scrollLeft, frame.clientWidth) === target))
    if (block) return { blockId: block.dataset.block!, offset: 0 }
  }
  function showPage(target: number, preserveAnchor = false) {
    const frame = viewport.current
    if (!frame) return
    const next = Math.max(0, Math.min(count.current - 1, target))
    frame.scrollLeft = next * frame.clientWidth
    currentPage.current = next; setPage(next)
    if (!preserveAnchor) anchor.current = location(next)
  }
  function locate(blockId: string, textOffset?: number) {
    const frame = viewport.current
    if (!frame) return
    const block = [...frame.querySelectorAll<HTMLElement>('[data-block]')].find(element => element.dataset.block === blockId)
    const word = textOffset === undefined ? undefined : [...frame.querySelectorAll<HTMLElement>('[data-start]')].find(element => Number(element.dataset.start) <= textOffset && Number(element.dataset.end) > textOffset)
    const element = word || block
    if (element) { anchor.current = { blockId, textOffset, offset: 0 }; showPage(elementPage(element), true) }
    else showPage(0)
  }
  useLayoutEffect(() => {
    anchor.current = undefined; currentPage.current = 0; setPage(0)
    if (viewport.current) viewport.current.scrollLeft = 0
  }, [chapterId, ready])
  useLayoutEffect(() => {
    const frame = viewport.current
    if (!frame || !ready) return
    const measure = () => setSize(previous => previous.width === frame.clientWidth && previous.height === frame.clientHeight ? previous : { width: frame.clientWidth, height: frame.clientHeight })
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(frame); window.addEventListener('resize', measure)
    let alive = true
    void document.fonts?.ready.then(() => { if (alive) refresh() })
    return () => { alive = false; observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [chapterId, ready, refresh, viewport])
  useLayoutEffect(() => {
    const frame = viewport.current
    if (!frame || !ready || !size.width) return
    const restoreAnchor = () => {
      // The viewport can resize before React updates the column dimensions.
      if (frame.clientWidth !== size.width || frame.clientHeight !== size.height) return
      count.current = pageCountForWidth(frame.scrollWidth, frame.clientWidth); setPageCount(count.current)
      if (anchor.current) locate(anchor.current.blockId, anchor.current.textOffset)
      else showPage(currentPage.current)
    }
    restoreAnchor()
    // Recheck after browser reflow, using the latest anchor if the reader has navigated.
    const animationFrame = window.requestAnimationFrame(restoreAnchor)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [size.width, size.height, chapterId, ready, revision])
  return { page, pageCount, size, revision, showPage, locate, location, refresh }
}
