import { normalize, selectionKey, type Chapter, type Keep, type Selection, type Span, type Block, type LearningLanguage } from './domain'

export function blockPositions(chapter: Chapter): { block: Block; offset: number }[] {
  let offset = 0
  return chapter.blocks.map(block => { const result = { block, offset }; offset += block.text.length + 2; return result })
}
export const chapterText = (chapter: Chapter) => chapter.blocks.map(block => block.text).join('\n\n')
export const wordSpans = (text: string, language = 'en'): Span[] => [...new Intl.Segmenter(language, { granularity: 'word' }).segment(text)]
  .filter(segment => segment.isWordLike).map(segment => ({ start: segment.index, end: segment.index + segment.segment.length }))

export function sortedSpans(spans: Span[], textLength: number): Span[] {
  const sorted = spans.map(span => ({ ...span })).sort((a, b) => a.start - b.start)
  if (!sorted.length || sorted.some((span, index) => !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > textLength || index > 0 && span.start < sorted[index - 1].end)) throw new Error('选中范围无效或重叠')
  return sorted
}
export function expandSelectionToWords(chapter: Chapter, span: Span, language: LearningLanguage): Span {
  const positions = blockPositions(chapter)
  const last = positions.at(-1)
  const [expanded] = sortedSpans([span], last ? last.offset + last.block.text.length : 0)
  for (const { block, offset } of positions) {
    const containsStart = expanded.start >= offset && expanded.start < offset + block.text.length
    const containsEnd = expanded.end > offset && expanded.end <= offset + block.text.length
    if (!containsStart && !containsEnd) continue
    const words = language === 'zh' ? block.tokens.filter(word => /[\p{L}\p{N}]/u.test(block.text.slice(word.start, word.end))) : wordSpans(block.text, language)
    for (const word of words) {
      const start = offset + word.start, end = offset + word.end
      if (start < expanded.start && end > expanded.start) expanded.start = start
      if (start < expanded.end && end > expanded.end) expanded.end = end
    }
  }
  return expanded
}

export function makeSelection(materialId: string, chapter: Chapter, spans: Span[], combined = false, language = 'en'): Selection {
  const text = chapterText(chapter)
  const sorted = sortedSpans(spans, text.length)
  if (!combined && sorted.length !== 1) throw new Error('连续选词只能有一个范围')
  const selectedText = sorted.map(span => text.slice(span.start, span.end)).join(' … ')
  if (!selectedText.trim()) throw new Error('请选择文字')
  const sentences = [...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)]
    .filter(sentence => sorted.some(span => span.start < sentence.index + sentence.segment.length && span.end > sentence.index))
    .map(sentence => sentence.segment.trim()).join('\n')
  const block = blockPositions(chapter).find(({ block, offset }) => sorted[0].start >= offset && sorted[0].start < offset + block.text.length)
  if (!block) throw new Error('无法定位原文')
  return { materialId, chapterId: chapter.id, blockId: block.block.id, spans: sorted, combined, text: selectedText, context: sentences }
}
export function highlights(chapter: Chapter, materialId: string, keeps: Keep[], language: LearningLanguage): Span[] {
  const text = chapterText(chapter)
  const normalized = normalize(text)
  const spans: Span[] = []
  const active = keeps.filter(keep => keep.active)
  const seen = new Set<string>()
  const words = wordSpans(text, language)
  for (const keep of active) {
    const selection = keep.selection
    if (selection.combined) {
      if (selection.materialId === materialId && selection.chapterId === chapter.id) spans.push(...selection.spans)
      continue
    }
    const query = normalize(selection.text)
    if (!query || seen.has(query)) continue
    seen.add(query)
    for (let start = normalized.indexOf(query); start !== -1; start = normalized.indexOf(query, start + query.length)) {
      const end = start + query.length
      if (language !== 'zh' && (!words.some(word => word.start === start) || !words.some(word => word.end === end))) continue
      spans.push({ start, end })
    }
  }
  return spans
}
export function coveringKeeps(selection: Selection, keeps: Keep[]): Keep[] {
  return keeps.filter(keep => keep.active && keep.selection.materialId === selection.materialId && keep.selection.chapterId === selection.chapterId && keep.selection.spans.some(a => selection.spans.some(b => a.start < b.end && a.end > b.start)))
}
export const keepForSelection = (selection: Selection, keeps: Keep[]) => keeps.find(keep => selectionKey(keep.selection) === selectionKey(selection))

export function adjustBoundaries(block: Block, range: Span, split: boolean): Span[] {
  sortedSpans([range], block.text.length)
  const cuts = new Set([0, block.text.length, ...block.tokens.flatMap(span => [span.start, span.end])])
  cuts.add(range.start); cuts.add(range.end)
  for (const cut of cuts) if (cut > range.start && cut < range.end) cuts.delete(cut)
  if (split) {
    let offset = range.start
    for (const character of block.text.slice(range.start, range.end)) { offset += character.length; cuts.add(offset) }
  }
  const points = [...cuts].sort((a, b) => a - b)
  return points.slice(0, -1).map((start, index) => ({ start, end: points[index + 1] }))
}
