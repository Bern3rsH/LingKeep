import type { Span } from './domain'

export interface NoteDraft { text: string; ai: Span[] }
export function validNoteRanges(text: string, ranges: Span[]): boolean {
  return ranges.every((span, index) => Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start && span.end <= text.length && (!index || ranges[index - 1].end <= span.start))
}
export const encodeNoteDraft = (draft: NoteDraft) => JSON.stringify({ noteDraftVersion: 1, ...draft })
export function decodeNoteDraft(value: string): NoteDraft {
  try {
    const draft = JSON.parse(value)
    if (draft?.noteDraftVersion === 1 && typeof draft.text === 'string') {
      try { if (Array.isArray(draft.ai) && validNoteRanges(draft.text, draft.ai)) return { text: draft.text, ai: draft.ai } } catch { /* Keep text even if its source metadata is damaged. */ }
      return { text: draft.text, ai: [] }
    }
  } catch { /* Existing unsaved plain-text drafts remain manual notes. */ }
  return { text: value, ai: [] }
}
export function editNoteDraft(before: NoteDraft, text: string): NoteDraft {
  if (text === before.text) return before
  let prefix = 0, suffix = 0
  const splitsCharacter = (value: string, index: number) => index > 0 && /[\uD800-\uDBFF]/.test(value[index - 1]) && /[\uDC00-\uDFFF]/.test(value[index])
  while (prefix < before.text.length && prefix < text.length && before.text[prefix] === text[prefix]) prefix++
  if (splitsCharacter(before.text, prefix) || splitsCharacter(text, prefix)) prefix--
  while (suffix < before.text.length - prefix && suffix < text.length - prefix && before.text[before.text.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++
  if (splitsCharacter(before.text, before.text.length - suffix) || splitsCharacter(text, text.length - suffix)) suffix--
  const removedEnd = before.text.length - suffix
  const shift = text.length - before.text.length
  const ai = before.ai.flatMap(span => {
    const parts: Span[] = []
    if (span.start < prefix) parts.push({ start: span.start, end: Math.min(span.end, prefix) })
    if (span.end > removedEnd) parts.push({ start: Math.max(span.start, removedEnd) + shift, end: span.end + shift })
    return parts
  })
  return { text, ai }
}
export function regenerateNoteDraft(before: NoteDraft, explanation: string): NoteDraft {
  const chunks: string[] = []
  let end = 0
  for (const span of before.ai) { chunks.push(before.text.slice(end, span.start)); end = span.end }
  chunks.push(before.text.slice(end))
  const manual = chunks.reduce((text, chunk) => text + (text && chunk && !/\s$/.test(text) && !/^\s/.test(chunk) ? '\n\n' : '') + chunk, '')
  const separator = manual && !manual.endsWith('\n\n') ? '\n\n' : ''
  const text = manual + separator + explanation
  return { text, ai: [{ start: manual.length, end: text.length }] }
}
