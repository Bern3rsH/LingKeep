import { StatusIcon } from './StatusIcon'
import { useI18n } from './i18n'
import { useState } from 'react'
import { invoke } from './api'
import { RenameDialog } from './RenameDialog'
import type { Material, ProfileId, Result } from '../../shared/domain'

interface Props { profileId: ProfileId; materials: Material[]; apply(result: Result): void; open(material: Material): void; report(error: unknown): void }
export function Library({ profileId, materials, apply, open, report }: Props) {
  const { t } = useI18n()
  const [showImport, setShowImport] = useState(false)
  const [kind, setKind] = useState<Material['kind']>('text')
  const [title, setTitle] = useState(''); const [input, setInput] = useState('')
  const [preview, setPreview] = useState<Material>(); const [token, setToken] = useState('')
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false); const [duplicate, setDuplicate] = useState('')
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<Material>()
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set())
  async function prepare() {
    setBusy(true); setError(''); setDuplicate('')
    try {
      const result = await invoke({ type: 'preview', profile: profileId, kind, title, input })
      if (result.material) { setPreview(result.material); setTitle(result.material.title); setToken(result.duplicateId!); setExcluded(new Set()) }
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  async function confirm(copy = false) {
    if (!preview) return
    setBusy(true); setError('')
    try {
      const result = await invoke({ type: 'import', profile: profileId, previewId: token, title, copy, blockIds: preview.chapters.flatMap(chapter => chapter.blocks).filter(block => !excluded.has(block.id)).map(block => block.id) })
      if (result.duplicateId) { setDuplicate(result.duplicateId); return }
      apply(result); setShowImport(false); setPreview(undefined); setInput(''); setTitle(''); setDuplicate('')
      if (result.material) open(result.material)
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  const confirmDelete = () => window.confirm(t('删除此材料？已保存的 Keep、原句、笔记和复习记录会保留。'))
  return <section className="page">
    <header className="page-heading"><div><h1>{t('Library')}</h1></div><button className="primary" onClick={() => setShowImport(true)}>{t("＋ 导入材料")}</button></header>
    <div className="section-caption"><span>{t('{count} 份学习材料', { count: materials.length })}</span></div>
    {materials.length === 0 ? <div className="empty"><div className="empty-icon">Aa</div><h2>{t("从一篇想读的文章开始")}</h2><p>{t("粘贴文本或网址，也可以导入 EPUB 或 PDF。")}</p><button onClick={() => setShowImport(true)}>{t("添加第一份材料")}</button></div> : <div className="material-grid">{materials.map(material => <article className="material-card" key={material.id}>
      <button className={`cover${material.cover && !failedCovers.has(material.cover) ? ' has-image' : ''}`} aria-label={material.title} onClick={() => open(material)}>{material.cover && !failedCovers.has(material.cover) ? <img src={`ling-asset://local/${material.cover}`} alt="" loading="lazy" onError={() => setFailedCovers(previous => new Set(previous).add(material.cover!))} /> : <><span>{material.kind === 'epub' ? 'EPUB' : material.kind === 'pdf' ? 'PDF' : material.kind === 'url' ? t("ARTICLE") : t("TEXT")}</span><strong>{material.title.slice(0, 24)}</strong><i>LingKeep</i></>}</button>
      <div className="card-detail"><button className="text-button material-title" title={material.title} onClick={() => open(material)}>{material.title}</button><MaterialProgress material={material} />
        <div className="row"><button className="text-button" onClick={() => setRenaming(material)}>{t("重命名")}</button><button className="text-button danger" onClick={() => { if (confirmDelete()) void invoke({ type: 'removeMaterial', profile: profileId, materialId: material.id }).then(apply).catch(report) }}>{t("删除")}</button></div>
      </div></article>)}</div>}
    {renaming && <RenameDialog key={renaming.id} material={renaming} profileId={profileId} apply={apply} close={() => setRenaming(undefined)} />}
    {showImport && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={t("导入学习材料")}>
      <header className="row spread"><h2>{t("导入学习材料")}</h2><button className="icon-button" aria-label={t("关闭导入")} disabled={busy} onClick={() => setShowImport(false)}><StatusIcon name="close" /></button></header>
      {!preview && <div className="tabs">{(['text', 'url', 'epub', 'pdf'] as const).map(value => <button className={kind === value ? 'active' : ''} key={value} onClick={() => { setKind(value); setError('') }}>{value === 'text' ? t("粘贴文本") : value === 'url' ? t("粘贴网址") : value === 'pdf' ? t("导入 PDF") : t("导入 EPUB")}</button>)}</div>}
      <label>{t("标题")}<input aria-label={t("材料标题")} value={title} placeholder={t("留空时自动获取")} onChange={event => setTitle(event.target.value)} /></label>
      {!preview ? <>{kind === 'text' ? <label>{t("正文")}<textarea aria-label={t("正文")} rows={9} value={input} onChange={event => setInput(event.target.value)} placeholder={t("在这里粘贴你想阅读的内容…")} /></label> : kind === 'url' ? <label>{t("网页地址")}<input aria-label={t("网页地址")} type="url" value={input} onChange={event => setInput(event.target.value)} placeholder="https://…" /></label> : <p className="notice">{t(kind === 'pdf' ? "选择文字型 PDF，扫描件请先进行 OCR。正文按原 PDF 页导入，空白或无文字的页面会略过。" : "选择可重排的文字 EPUB。加密和固定版式暂不支持。")}</p>}<button className="primary" disabled={busy} onClick={() => void prepare()}>{busy ? t("正在提取正文与图片…") : kind === 'epub' ? t("选择 EPUB 并预览") : kind === 'pdf' ? t("选择 PDF 并预览") : t("提取并预览")}</button></> : <>
        <p className="muted">{t("检查正文，取消勾选误提取内容后导入。图片缺失不影响正文保存。")}</p>
        <div className="import-preview">{preview.chapters.map(chapter => <section key={chapter.id}><h3>{chapter.title}</h3>{chapter.blocks.map(block => <label className="preview-block" key={block.id}><input type="checkbox" checked={!excluded.has(block.id)} onChange={event => setExcluded(previous => { const next = new Set(previous); if (event.target.checked) next.delete(block.id); else next.add(block.id); return next })} /><span>{block.image ? t('图片{status}：{caption}', { status: block.image.missing ? t('（缺失，可稍后重试）') : '', caption: block.image.caption }) : block.text}</span></label>)}</section>)}</div>
        {duplicate ? <div className="notice"><p>{t("当前用户已有相同材料。")}</p><div className="row"><button onClick={() => { const existing = materials.find(material => material.id === duplicate); if (existing) { setShowImport(false); open(existing) } }}>{t("打开已有材料")}</button><button disabled={busy} onClick={() => void confirm(true)}>{t("仍然导入副本")}</button></div></div> : <div className="row"><button onClick={() => setPreview(undefined)} disabled={busy}>{t("返回编辑")}</button><button className="primary" disabled={busy} onClick={() => void confirm()}>{busy ? t("保存中…") : t("确认导入")}</button></div>}
      </>}
      {error && <p className="error" role="alert">{t(error)}</p>}
    </section></div>}
  </section>
}

function MaterialProgress({ material }: { material: Material }) {
  const { t } = useI18n()
  const chapterIndex = material.chapters.findIndex(chapter => chapter.id === material.progress?.chapterId)
  const pending = material.chapters.some(chapter => chapter.segmentation !== 'ready')
  if (material.kind !== 'epub' && material.kind !== 'pdf') return <p className="muted">{t('{count} 章节 · {status}', { count: material.chapters.length, status: t(pending ? '待分词' : material.progress ? '继续阅读' : '尚未开始') })}</p>
  return <p className="muted epub-progress">
    {chapterIndex >= 0 && <span className="chapter-name" title={material.chapters[chapterIndex].title}>{material.chapters[chapterIndex].title}</span>}
    <span>{t(pending ? '待分词' : chapterIndex >= 0 ? '继续阅读' : '尚未开始')}</span>
    <span className="chapter-total">{t(material.kind === 'pdf' ? '共 {count} 页' : '共 {count} 章节', { count: material.chapters.length })}</span>
  </p>
}
