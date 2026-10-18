import { useEffect, useRef, useState } from 'react'
import type { Material, ProfileId, Result } from '../../shared/domain'
import { invoke } from './api'
import { useI18n } from './i18n'

export function RenameDialog({ material, profileId, apply, close }: { material: Material; profileId: ProfileId; apply(result: Result): void; close(): void }) {
  const { t } = useI18n()
  const [title, setTitle] = useState(material.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true; input.current?.focus(); input.current?.select()
    return () => { alive.current = false }
  }, [])
  async function save() {
    if (pending.current) return
    const nextTitle = title.trim()
    if (!nextTitle) { setError('标题不能为空'); input.current?.focus(); return }
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await invoke({ type: 'rename', profile: profileId, materialId: material.id, title: nextTitle })
      if (alive.current) { apply(result); close() }
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : '重命名失败，请重试。')
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return <div className="modal-backdrop"><form className="modal rename-modal" role="dialog" aria-modal="true" aria-label={t('重命名')} onSubmit={event => { event.preventDefault(); void save() }} onKeyDown={event => { if (event.key === 'Escape' && !pending.current) { event.preventDefault(); close() } }}>
    <h2>{t('重命名')}</h2>
    <label>{t('材料标题')}<input ref={input} aria-label={t('材料标题')} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
    {error && <p className="error" role="alert">{t(error)}</p>}
    <div className="row"><button type="button" disabled={busy} onClick={close}>{t('取消')}</button><button type="submit" className="primary" disabled={busy || !title.trim()}>{busy ? t('保存中…') : t('保存')}</button></div>
  </form></div>
}
