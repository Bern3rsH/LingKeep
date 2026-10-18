import { StatusIcon } from './StatusIcon'
import { useI18n } from './i18n'
import { useId, useRef, useState } from 'react'
import { flushDrafts, invoke, useAutosave } from './api'
import { NoteEditor } from './Notes'
import { AppSelect } from './AppSelect'
import { dueKeeps } from '../../shared/review'
import { makeSelection } from '../../shared/reading'
import { levelLabels, targetLanguage, type Keep, type Material, type Profile, type ProfileId, type Result, type Selection } from '../../shared/domain'

interface Props { profileId: ProfileId; profile: Profile; apply(result: Result): void; jump(material: Material, selection?: Selection): void; report(error: unknown): void }
export function Keeps({ profileId, profile, apply, jump, report }: Props) {
  const { t } = useI18n()
  const [search, setSearch] = useState(''); const [ignored, setIgnored] = useState(false); const [reviewing, setReviewing] = useState(false)
  const [selection, setSelection] = useState<{ profileId: ProfileId; ids: Set<string> }>({ profileId, ids: new Set() })
  const [batchLevel, setBatchLevel] = useState('1')
  const [busy, setBusy] = useState(false)
  const [batchError, setBatchError] = useState('')
  const pending = useRef(false)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const deleteTitleId = useId()
  const keeps = profile.keeps.filter(keep => (ignored || keep.active) && `${keep.selection.text} ${keep.meaning.text} ${keep.selection.context}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const selectedKeeps = keeps.filter(keep => selection.profileId === profileId && selection.ids.has(keep.id))
  const selectedIds = new Set(selectedKeeps.map(keep => keep.id))
  const allSelected = keeps.length > 0 && selectedKeeps.length === keeps.length
  function clearSelection() { setSelection({ profileId, ids: new Set() }); setBatchError('') }
  function selectKeep(id: string, checked: boolean) {
    const ids = new Set(selectedIds)
    if (checked) ids.add(id)
    else ids.delete(id)
    setSelection({ profileId, ids }); setBatchError('')
  }
  async function batch(changes: { level?: number; active?: boolean } | 'delete') {
    if (pending.current || !selectedKeeps.length) return
    pending.current = true; setBusy(true); setBatchError('')
    try {
      if (changes === 'delete' && !await flushDrafts()) throw new Error('仍有内容保存失败，请先重试保存')
      const keepIds = selectedKeeps.map(keep => keep.id)
      apply(await invoke(changes === 'delete' ? { type: 'deleteKeeps', profile: profileId, keepIds } : { type: 'batchKeeps', profile: profileId, keepIds, changes }))
      deleteDialog.current?.close()
      clearSelection()
    } catch (error) { setBatchError(error instanceof Error ? error.message : '操作失败，请重试') }
    finally { pending.current = false; setBusy(false) }
  }
  const due = dueKeeps(profile.keeps)
  if (reviewing) return <Review profileId={profileId} keeps={profile.keeps} apply={apply} exit={() => setReviewing(false)} />
  return <section className="page keep-page"><header className="page-heading"><h1>{t('Keep')}</h1><button className="primary" disabled={busy || !due.length} onClick={() => setReviewing(true)}>{t('开始复习 · {count} 条到期', { count: due.length })}</button></header>
    <div className="row keep-filters"><input aria-label={t("搜索 Keep")} value={search} disabled={busy} onChange={event => { setSearch(event.target.value); clearSelection() }} placeholder={t("搜索词条、释义或原句…")} /><label className="inline-label"><input type="checkbox" checked={ignored} disabled={busy} onChange={event => { setIgnored(event.target.checked); clearSelection() }} />{t("显示已移出内容")}</label></div>
    {selectedKeeps.length > 0 && <div className="keep-batch" aria-busy={busy}>
      <span>{t('已选 {count} 条', { count: selectedKeeps.length })}</span>
      <button disabled={busy || !selectedKeeps.length} onClick={clearSelection}>{t('清空选择')}</button>
      <AppSelect aria-label={t('批量记忆等级')} value={batchLevel} disabled={busy || !selectedKeeps.length} onValueChange={setBatchLevel}>{[1, 2, 3, 4, 5].map(level => <option key={level} value={String(level)}>{t(levelLabels[level])}</option>)}</AppSelect>
      <button disabled={busy || !selectedKeeps.length} onClick={() => void batch({ level: Number(batchLevel), active: true })}>{t('应用等级')}</button>
      <button disabled={busy || !selectedKeeps.some(keep => keep.active)} onClick={() => void batch({ active: false })}>{t('移出 Keep')}</button>
      <button disabled={busy || !selectedKeeps.some(keep => !keep.active)} onClick={() => void batch({ active: true })}>{t('恢复 Keep')}</button>
      <button ref={deleteButton} className="danger" disabled={busy || !selectedKeeps.length} onClick={() => { setBatchError(''); deleteDialog.current?.showModal() }}>{t('永久删除')}</button>
      {busy && <small>{t('保存中…')}</small>}
    </div>}
    {batchError && <p className="error" role="alert">{t(batchError)}</p>}
    {!keeps.length ? <div className="empty"><div className="empty-icon">K</div><h2>{search ? t("没有匹配内容") : t("让每一个词留在语境里")}</h2><p>{t("阅读时选择记忆等级，将单词、短语或句子加入 Keep。")}</p></div> : <div className="keep-list">
      <div className="keep-heading-row"><label className="keep-choice"><input type="checkbox" aria-label={t('全选当前结果')} checked={allSelected} disabled={busy} ref={input => { if (input) input.indeterminate = selectedKeeps.length > 0 && !allSelected }} onChange={() => { setSelection({ profileId, ids: allSelected ? new Set() : new Set(keeps.map(keep => keep.id)) }); setBatchError('') }} /></label><div className="keep-list-heading"><span>{t('词条')}</span><span>{t('释义')}</span><span>{t('原句')}</span></div></div>
      {keeps.map(keep => <KeepDetail key={`${profileId}:${keep.id}`} keep={keep} checked={selectedIds.has(keep.id)} disabled={busy} select={checked => selectKeep(keep.id, checked)} {...{ profileId, profile, apply, jump, report }} />)}
    </div>}
    <dialog ref={deleteDialog} className="modal keep-delete-dialog" aria-labelledby={deleteTitleId} onCancel={event => { if (pending.current) event.preventDefault() }} onClose={() => deleteButton.current?.focus()}>
      <h2 id={deleteTitleId}>{t('永久删除 {count} 条 Keep？', { count: selectedKeeps.length })}</h2>
      <p>{t('所选条目的释义、笔记和复习记录将被删除，无法恢复。')}</p>
      {batchError && <p className="error" role="alert">{t(batchError)}</p>}
      <div className="row"><button autoFocus disabled={busy} onClick={() => deleteDialog.current?.close()}>{t('取消')}</button><button className="danger" disabled={busy || !selectedKeeps.length} onClick={() => void batch('delete')}>{busy ? t('保存中…') : t('确认永久删除')}</button></div>
    </dialog>
  </section>
}
function KeepDetail({ keep, checked, disabled, select, profileId, profile, apply, jump, report }: Props & { keep: Keep; checked: boolean; disabled: boolean; select(checked: boolean): void }) {
  const { t } = useI18n()
  const dialogTitleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const meaning = useAutosave(`${profileId}:keep-meaning:${keep.id}`, keep.meaning.text, async text => { apply(await invoke({ type: 'editKeep', profile: profileId, keepId: keep.id, changes: { meaning: { text, source: 'manual' } } })) })
  const material = profile.materials.find(item => item.id === keep.selection.materialId)
  const chapter = material?.chapters.find(item => item.id === keep.selection.chapterId)
  let valid = false
  if (chapter) try { valid = makeSelection(material!.id, chapter, keep.selection.spans, keep.selection.combined, targetLanguage(profileId)).text === keep.selection.text } catch { /* Saved context remains readable. */ }
  return <article className={`keep-detail panel${checked ? ' is-selected' : ''}`}>
    <div className="keep-row"><label className="keep-choice"><input type="checkbox" aria-label={t('选择 {term}', { term: keep.selection.text })} checked={checked} disabled={disabled} onChange={event => select(event.target.checked)} /></label><div className="keep-summary">
      <strong className="keep-term">{keep.selection.text}</strong><span className="keep-summary-meaning">{meaning.value}</span><span className="keep-summary-context">{keep.selection.context}</span>
    </div>
    <button ref={moreButton} className="keep-more" disabled={disabled} aria-label={t('查看 {term} 的完整内容', { term: keep.selection.text })} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>•••</button></div>
    <dialog ref={dialog} className="modal keep-dialog" aria-labelledby={dialogTitleId} onClose={() => moreButton.current?.focus()} onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close()
    }}>
    <header className="row spread"><h2 id={dialogTitleId}>{keep.selection.text}</h2><button autoFocus aria-label={t('关闭')} onClick={() => dialog.current?.close()}><StatusIcon name="close" /></button></header>
    <blockquote>{keep.selection.context}</blockquote>
    {material ? <><div className="keep-source"><p className="muted">{t("来源：")}{material.title}{chapter && ` · ${chapter.title}`}</p><button onClick={() => { dialog.current?.close(); jump(material, valid ? keep.selection : undefined) }}>{valid ? t("跳回原文 ↗") : t("打开来源材料")}</button></div>{!valid && <p className="notice">{t("无法定位原文")}</p>}</> : <p className="notice">{t("来源材料已删除")}</p>}
    <label>{t("当前语境释义")}<textarea aria-label={t("Keep 释义")} rows={3} value={meaning.value} onChange={event => meaning.change(event.target.value)} /></label><div className="save-status"><small>{t(meaning.status)}</small>{meaning.status.startsWith('保存失败') && <button onClick={() => void meaning.flush()}>{t("重试保存")}</button>}</div>
    <div className="status-controls">{[0, 1, 2, 3, 4, 5].map(level => <button key={level} aria-label={t(levelLabels[level])} aria-pressed={level ? keep.active && keep.level === level : !keep.active} onClick={() => void invoke({ type: 'editKeep', profile: profileId, keepId: keep.id, changes: level ? { level, active: true } : { active: false } }).then(apply).catch(report)}>{level === 0 ? <StatusIcon name="close" /> : level === 5 ? <StatusIcon name="check" /> : level}</button>)}</div>
    <NoteEditor profileId={profileId} keep={keep} apply={apply} />
    </dialog>
  </article>
}
function Review({ profileId, keeps, apply, exit }: { profileId: ProfileId; keeps: Keep[]; apply(result: Result): void; exit(): void }) {
  const { t } = useI18n()
  const [queue] = useState(() => dueKeeps(keeps).map(keep => keep.id)); const [index, setIndex] = useState(0)
  const [shown, setShown] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const operations = useRef(new Map<string, string>())
  const keep = keeps.find(keep => keep.id === queue[index] && keep.active)
  async function grade(rating: 'Again' | 'Hard' | 'Good') {
    if (!keep) return
    const operationId = operations.current.get(keep.id) || crypto.randomUUID(); operations.current.set(keep.id, operationId)
    setBusy(true); setError('')
    try {
      apply(await invoke({ type: 'review', profile: profileId, keepId: keep.id, rating, operationId }))
      setIndex(index + 1); setShown(false)
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <section className="page review"><header className="row spread"><button onClick={exit} disabled={busy}>{t("← 返回 Keep")}</button><span className="muted">{t('语境复习 · {current} / {total}', { current: Math.min(index + 1, queue.length), total: queue.length })}</span></header>
    {keep ? <article className="review-card"><p className="eyebrow">{t("RECALL IN CONTEXT")}</p><h1>{keep.selection.text}</h1><blockquote>{keep.selection.context}</blockquote>
      {!shown ? <button className="primary" onClick={() => setShown(true)}>{t("显示释义")}</button> : <><div className="review-meaning">{keep.meaning.text}</div><div className="review-grades"><button disabled={busy} onClick={() => void grade('Again')}>{t("不认识")}</button><button disabled={busy} onClick={() => void grade('Hard')}>{t("模糊")}</button><button className="primary" disabled={busy} onClick={() => void grade('Good')}>{t("认识")}</button></div></>}
      {error && <p className="error" role="alert">{t(error)}{t("，请重试评分。")}</p>}
    </article> : <div className="empty"><div className="empty-icon"><StatusIcon name="check" size={32} /></div><h1>{t("本轮复习完成")}</h1><p>{t("已保存的评分会用于安排下次复习。")}</p><button onClick={exit}>{t("返回 Keep")}</button></div>}
  </section>
}
