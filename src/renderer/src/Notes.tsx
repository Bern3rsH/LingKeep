import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StatusIcon } from './StatusIcon'
import { useI18n } from './i18n'
import { invoke, useAutosave } from './api'
import { decodeNoteDraft, editNoteDraft, encodeNoteDraft, regenerateNoteDraft } from '../../shared/note'
import { selectionKey, type Keep, type Selection, type ProfileId, type Result, type Span } from '../../shared/domain'

export function NoteEditor({ profileId, keep, apply }: { profileId: ProfileId; keep: Keep; apply(result: Result): void }) {
  return <ContextNoteEditor profileId={profileId} selection={keep.selection} initialNote={keep.note} initialAI={keep.noteAI} keepId={keep.id} titleKey="附属笔记" rows={3} apply={apply} />
}
export function ContextNoteEditor({ profileId, selection, initialNote, initialAI = [], keepId, titleKey = '附属笔记', rows = 5, apply }: { profileId: ProfileId; selection: Selection; initialNote: string; initialAI?: Span[]; keepId?: string; titleKey?: string; rows?: number; apply(result: Result): void }) {
  const { t } = useI18n()
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const pending = useRef(false)
  const noteInput = useRef<HTMLTextAreaElement>(null)
  const identity = `${profileId}:${selectionKey(selection)}`
  const note = useAutosave(`${profileId}:note:${selectionKey(selection)}`, encodeNoteDraft({ text: initialNote, ai: initialAI }), async value => {
    const { text, ai } = decodeNoteDraft(value)
    const metadata = ai.length || initialAI.length ? { noteAI: ai } : {}
    apply(await invoke(keepId ? { type: 'editKeep', profile: profileId, keepId, changes: { note: text, ...metadata } } : { type: 'contextNote', profile: profileId, selection, note: text, ...metadata }))
  })
  const draft = decodeNoteDraft(note.value)
  const latestNote = useRef(draft); latestNote.current = draft
  function change(text: string) {
    const next = editNoteDraft(latestNote.current, text)
    latestNote.current = next
    note.change(encodeNoteDraft(next))
  }
  useLayoutEffect(() => {
    const input = noteInput.current
    if (!input) return
    const fit = () => {
      if (!input.clientWidth) return
      input.style.height = ''
      if (!input.value || !input.scrollHeight) return
      const style = getComputedStyle(input)
      const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
      input.style.height = `${Math.ceil(Math.max(input.offsetHeight, input.scrollHeight + borders))}px`
    }
    fit()
    let width = input.clientWidth
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
      const nextWidth = input.clientWidth
      if (nextWidth !== width) { width = nextWidth; fit() }
    })
    observer?.observe(input)
    window.addEventListener('resize', fit)
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit) }
  }, [draft.text, rows, identity])
  useEffect(() => {
    request.current++; pending.current = false; setGenerating(false); setError('')
    return () => { request.current++ }
  }, [identity])
  async function explain() {
    if (pending.current) return
    pending.current = true; setGenerating(true); setError('')
    const current = ++request.current
    try {
      const result = await invoke({ type: 'explainNote', profile: profileId, selection })
      if (request.current !== current) return
      const explanation = result.explanation?.trim()
      if (!explanation) throw new Error('AI 讲解内容无效，请重试')
      const next = regenerateNoteDraft(latestNote.current, explanation)
      latestNote.current = next
      note.change(encodeNoteDraft(next))
    } catch (error) {
      if (request.current === current) setError(error instanceof Error ? error.message : 'AI 讲解失败，请重试')
    } finally {
      if (request.current === current) { pending.current = false; setGenerating(false) }
    }
  }
  return <section className="notes"><h3 className="meaning-section-title">{t(titleKey)}</h3>
    <div className="note-input"><textarea ref={noteInput} aria-label={t(keepId ? "Keep 笔记" : "语境笔记")} rows={rows} value={draft.text} onChange={event => change(event.target.value)} placeholder={t("写下你的理解… 自动保存。")} />
      <button type="button" className="note-ai-button" aria-label={t(generating ? '正在生成讲解…' : 'AI 语境讲解')} title={t('AI 语境讲解')} disabled={generating} aria-busy={generating} onClick={() => void explain()}>{generating ? <span className="meaning-spinner" aria-hidden="true" /> : <StatusIcon name="sparkles" />}</button>
    </div>
    {error && <p className="error" role="alert">{t(error)}</p>}
    <div className="save-status"><small>{t(note.status)}</small>{note.status.startsWith('保存失败') && <button onClick={() => void note.flush()}>{t("重试保存")}</button>}</div>
  </section>
}
