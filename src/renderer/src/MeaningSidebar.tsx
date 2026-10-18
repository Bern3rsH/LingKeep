import { StatusIcon } from './StatusIcon'
import { useI18n } from './i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { invoke, useAutosave } from './api'
import { selectionKey, levelLabels, targetLanguage, type ProfileId, type Profile, type Selection, type Meaning, type Result } from '../../shared/domain'
import { coveringKeeps, keepForSelection } from '../../shared/reading'
import { ContextNoteEditor } from './Notes'
import { pronunciation } from './pronunciation'

const levelDescriptions = [
  '已忽略；笔记和复习历史会保留。',
  '陌生：还不认识，需要学习这个语境中的用法。',
  '有印象：见过，但还不能确定含义。',
  '基本理解：能结合语境理解，还需要巩固。',
  '熟悉：能较轻松地理解这个语境中的用法。',
  '已掌握：能熟练理解这个语境中的用法。'
]

export function MeaningSidebar({ selection, profileId, profile, apply, settings, choose }: { selection: Selection; profileId: ProfileId; profile: Profile; apply(result: Result): void; settings(): void; choose(selection: Selection): void }) {
  const { t } = useI18n()
  const [initial, setInitial] = useState<Meaning>({ text: '', source: 'manual' })
  const [local, setLocal] = useState<Meaning[]>([]); const [ai, setAI] = useState<Meaning>()
  const [dictionaryError, setDictionaryError] = useState(''); const [aiError, setAIError] = useState('')
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const [pendingLevel, setPendingLevel] = useState<number>()
  const alive = useRef(true); const touched = useRef(false); const source = useRef<Meaning['source']>('manual')
  const autoKeep = useRef(false)
  const candidatePending = useRef(false)
  const explanationPending = useRef(false)
  const meaningInput = useRef<HTMLTextAreaElement>(null)
  const keep = keepForSelection(selection, profile.keeps)
  const currentLevel = pendingLevel ?? (keep?.active ? keep.level : 0)
  const draft = useAutosave(`${profileId}:meaning:${selectionKey(selection)}`, initial.text, async text => {
    const selectingMeaning = autoKeep.current
    if (selectingMeaning && alive.current) setPendingLevel(keep?.active ? keep.level : 1)
    try {
      const response = await invoke({ type: selectingMeaning ? 'selectMeaning' : 'bind', profile: profileId, selection, meaning: { text, source: source.current } })
      apply(response)
    } finally { if (selectingMeaning && alive.current) setPendingLevel(undefined) }
  })
  useLayoutEffect(() => {
    const input = meaningInput.current
    if (!input) return
    const fit = () => {
      input.style.height = ''
      if (!input.value || !input.scrollHeight) return
      const style = getComputedStyle(input)
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      input.style.height = `${Math.ceil(input.scrollHeight + borders)}px`
    }
    fit()
    let width = input.getBoundingClientRect().width
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width
      if (nextWidth !== undefined && nextWidth !== width) { width = nextWidth; fit() }
    })
    observer?.observe(input)
    window.addEventListener('resize', fit)
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit) }
  }, [draft.value])
  const dictionary = async () => {
    setDictionaryError('')
    try { const response = await invoke({ type: 'lookup', profile: profileId, selection }); if (alive.current) setLocal(response.meanings || []) }
    catch (error) { if (alive.current) setDictionaryError((error as Error).message) }
  }
  const explain = async (regenerate = false) => {
    if (explanationPending.current) return
    explanationPending.current = true
    setLoading(true); setAIError('')
    try { const response = await invoke({ type: 'explain', profile: profileId, selection, regenerate }); if (alive.current) setAI(response.meaning) }
    catch (error) { if (alive.current) setAIError((error as Error).message) }
    finally { explanationPending.current = false; if (alive.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true
    void invoke({ type: 'binding', profile: profileId, selection }).then(response => {
      if (alive.current && !touched.current) { const meaning = response.meaning || { text: '', source: 'manual' as const }; source.current = meaning.source; setInitial(meaning) }
    }).catch(error => { if (alive.current) setError((error as Error).message) })
    void dictionary(); void explain()
    return () => { alive.current = false }
  }, [])
  const candidates = [...(ai ? [ai] : []), ...local]
  async function selectCandidate(meaning: Meaning) {
    if (busy || candidatePending.current) return
    candidatePending.current = true; setBusy(true); setError('')
    touched.current = true; source.current = meaning.source; autoKeep.current = true
    draft.change(meaning.text)
    try { await draft.flush() }
    finally { candidatePending.current = false; if (alive.current) setBusy(false) }
  }
  async function status(level: number) {
    const meaning = draft.value.trim() ? { text: draft.value, source: source.current } : candidates[0]
    if (level && !meaning?.text.trim()) { setError('请选择或填写释义'); return }
    setBusy(true); setError('')
    try {
      await draft.flush()
      apply(await invoke({ type: 'status', profile: profileId, selection, level, meaning }))
      if (level && meaning && !draft.value.trim()) { source.current = meaning.source; draft.change(meaning.text) }
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  async function replay() {
    setError('')
    try { await pronunciation.play(selection, profileId) }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '发音暂不可用，请重试') }
  }
  return <aside className="meaning-sidebar with-selection">
    <div className="meaning-scroll">
    <div className="lookup-heading"><h2>{selection.text}</h2><button type="button" className="pronunciation-button" aria-label={t('重复发音')} title={t('重复发音')} onClick={() => void replay()}><StatusIcon name="speaker" size={18} /></button></div><blockquote>{selection.context}</blockquote>
    <label><span className="meaning-section-title">{t("当前语境的释义")}</span><textarea ref={meaningInput} className="meaning-input" aria-label={t("当前语境释义")} value={draft.value} disabled={busy} rows={1} onChange={event => { autoKeep.current = false; touched.current = true; source.current = 'manual'; draft.change(event.target.value) }} placeholder={t("选择下方释义，或在这里手动填写")} /></label>
    <div className="save-status"><small>{t(draft.status)}</small>{draft.status.startsWith('保存失败') && <button onClick={() => void draft.flush()}>{t("重试保存")}</button>}</div>
    <section className="candidate-section"><div className="row spread"><h3 className="meaning-section-title">{t("释义")}</h3></div>
      {loading && <div className="candidate candidate-loading" role="status" aria-busy="true"><span className="meaning-spinner" aria-hidden="true" /><span>{t("正在生成释义…")}</span></div>}
      {aiError && <div className="notice"><p>{t(aiError)}</p><button onClick={aiError.includes('请先配置') ? settings : () => void explain()}>{aiError.includes('请先配置') ? t("前往 Setting") : t("重试")}</button></div>}
      {!loading && ai && <div className="ai-candidate"><button className={`candidate ${draft.value === ai.text ? 'selected' : ''}`} disabled={busy} onClick={() => void selectCandidate(ai)}><span>{ai.text}</span><span className="candidate-icons" aria-hidden="true"><span className="candidate-ai-space" /><StatusIcon name="plus" /></span></button><button type="button" className="candidate-ai-icon" aria-label={t('重新生成')} title={t('重新生成')} disabled={busy} onClick={() => void explain(true)}><StatusIcon name="sparkles" size={14} /></button></div>}
      {dictionaryError && <div className="notice"><p>{t(dictionaryError)}</p><button onClick={() => void dictionary()}>{t("重试词库")}</button></div>}
      {!dictionaryError && !local.length && <p className="muted">{t(targetLanguage(profileId) === 'fr' ? "法语释义使用 AI，也可以手动填写。" : "未找到本地义项，可使用 AI 或手动填写。")}</p>}
      {local.map((meaning, index) => <button className={`candidate ${draft.value === meaning.text ? 'selected' : ''}`} key={index} disabled={busy} onClick={() => void selectCandidate(meaning)}><span>{meaning.text}</span><StatusIcon name="plus" /></button>)}
    </section>
    {keep?.active && <ContextNoteEditor profileId={profileId} selection={selection} initialNote={keep.note} initialAI={keep.noteAI} keepId={keep.id} rows={3} apply={apply} />}
    {coveringKeeps(selection, profile.keeps).filter(item => item.id !== keep?.id).map(item => <button className="overlap" key={item.id} onClick={() => choose(item.selection)}>{t("查看覆盖此处的 Keep：")}{item.selection.text}</button>)}
    </div>
    <div className="meaning-actions">
    <div className="status-controls" aria-label={t("记忆状态")}>{[0, 1, 2, 3, 4, 5].map(level => <button key={level} title={t(levelLabels[level])} aria-label={t(levelLabels[level])} aria-pressed={currentLevel === level} disabled={busy} onClick={() => void status(level)}>{level === 0 ? <StatusIcon name="close" /> : level === 5 ? <StatusIcon name="check" /> : level}</button>)}</div>
    <p className="muted small" aria-live="polite">{t(keep || pendingLevel !== undefined ? levelDescriptions[currentLevel] : '选择释义或等级加入 Keep。')}</p>
    {error && <p className="error" role="alert">{t(error)}</p>}
    </div>
  </aside>
}
