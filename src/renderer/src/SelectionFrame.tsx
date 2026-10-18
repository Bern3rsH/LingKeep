import { useLayoutEffect, useState, type RefObject } from 'react'
import type { Selection } from '../../shared/domain'

interface Bounds { left: number; top: number; right: number; bottom: number }
const FRAME_PADDING = 2
export function visibleSelectionBounds(rects: Bounds[], viewport: Bounds): Bounds | undefined {
  const visible = rects.map(rect => ({ left: Math.max(rect.left, viewport.left), top: Math.max(rect.top, viewport.top), right: Math.min(rect.right, viewport.right), bottom: Math.min(rect.bottom, viewport.bottom) })).filter(rect => rect.right > rect.left && rect.bottom > rect.top)
  if (!visible.length) return
  return { left: Math.min(...visible.map(rect => rect.left)), top: Math.min(...visible.map(rect => rect.top)), right: Math.max(...visible.map(rect => rect.right)), bottom: Math.max(...visible.map(rect => rect.bottom)) }
}
export function selectionFrames(segments: { selected: boolean; text: string; rects: Bounds[] }[], combined: boolean, viewport: Bounds): Bounds[] {
  const groups: Bounds[][] = []
  let separated = true
  for (const segment of segments) {
    if (!segment.selected) {
      if (combined && segment.text.trim()) separated = true
      continue
    }
    if (separated || !groups.length) groups.push([])
    groups.at(-1)!.push(...segment.rects)
    separated = false
  }
  return groups.flatMap(group => { const bounds = visibleSelectionBounds(group, viewport); return bounds ? [bounds] : [] })
}
export function SelectionFrame({ viewport, selection, page, width, height, revision }: { viewport: RefObject<HTMLDivElement | null>; selection?: Selection; page: number; width: number; height: number; revision: number }) {
  const [bounds, setBounds] = useState<Bounds[]>([])
  useLayoutEffect(() => {
    const content = viewport.current
    if (!content || !selection) { setBounds([]); return }
    let animationFrame: number | undefined
    let settledFrame: number | undefined
    const measure = () => {
      const stage = content.parentElement?.getBoundingClientRect()
      if (!stage) return
      const segments = [...content.querySelectorAll<HTMLElement>('[data-start]')].map(element => {
        const selected = selection.spans.some(span => span.start < Number(element.dataset.end) && span.end > Number(element.dataset.start))
        return { selected, text: element.textContent || '', rects: selected ? [...element.getClientRects()] : [] }
      })
      const next = selectionFrames(segments, selection.combined, content.getBoundingClientRect()).map(visible => ({ left: visible.left - stage.left - FRAME_PADDING, top: visible.top - stage.top - FRAME_PADDING, right: visible.right - stage.left + FRAME_PADDING, bottom: visible.bottom - stage.top + FRAME_PADDING }))
      setBounds(previous => previous.length === next.length && previous.every((bounds, index) => bounds.left === next[index].left && bounds.top === next[index].top && bounds.right === next[index].right && bounds.bottom === next[index].bottom) ? previous : next)
    }
    const schedule = () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => { animationFrame = undefined; measure() })
    }
    measure()
    // Pagination also restores its anchor in a frame after resize.
    settledFrame = window.requestAnimationFrame(() => { settledFrame = undefined; schedule() })
    content.addEventListener('scroll', schedule)
    return () => {
      content.removeEventListener('scroll', schedule)
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
      if (settledFrame !== undefined) window.cancelAnimationFrame(settledFrame)
    }
  }, [viewport, selection, page, width, height, revision])
  return selection ? bounds.map((bounds, index) => <div key={index} className="reader-selection-frame" aria-hidden="true" style={{ left: bounds.left, top: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }} />) : null
}
