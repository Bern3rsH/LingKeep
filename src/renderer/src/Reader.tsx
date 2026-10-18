import { SelectionFrame } from './SelectionFrame'
import { READER_PAGE_PADDING, useReaderPagination } from './useReaderPagination'
import { AppSelect } from './AppSelect'
import { StatusIcon } from './StatusIcon'
import { useI18n } from './i18n'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { Block, Chapter, Material, Profile, ProfileId, Result, Selection, Span } from '../../shared/domain'
import { selectionKey, targetLanguage } from '../../shared/domain'
import { blockPositions, chapterText, expandSelectionToWords, highlights, makeSelection, wordSpans } from '../../shared/reading'
import { invoke } from './api'
import { MeaningSidebar } from './MeaningSidebar'
import { pronunciation } from './pronunciation'

const CHAPTER_MENU_MIN_WIDTH = 240

interface Props { profileId: ProfileId; profile: Profile; material: Material; jump?: Selection; initialSelection?: Selection; onSelection(selection?: Selection): void; apply(result: Result): void; report(error: unknown): void; back(): void; settings(): void }
export function Reader({ profileId, profile, material, jump, initialSelection, onSelection, apply, report, back, settings }: Props) {
  const { t } = useI18n()
  const [chapterId, setChapterId] = useState(jump?.chapterId || material.progress?.chapterId || material.chapters[0].id)
  const pendingChapter = useRef<{ id: string; edge: 'start' | 'end' } | undefined>(undefined)
  const chapter = material.chapters.find(item => item.id === chapterId) || material.chapters[0]
  const chapterIndex = material.chapters.indexOf(chapter)
  const [chapterTransition, setChapterTransition] = useState(false)
  const [selection, setSelection] = useState<Selection | undefined>(initialSelection)
  const [lookupCollapsed, setLookupCollapsed] = useState(false)
  const lookupPanelId = useId()
  const [combine, setCombine] = useState(false); const [fragments, setFragments] = useState<Span[]>([])
  const [busy, setBusy] = useState(false); const [temporary, setTemporary] = useState(Boolean(jump))
  const viewport = useRef<HTMLDivElement>(null)
  const draggedSelection = useRef(false)
  const originalProgress = useRef(material.progress)
  const jumpPending = useRef(Boolean(jump))
  const restorePosition = useRef<Material['progress']>(undefined)
  const lastProgress = useRef<Material['progress']>(undefined)
  const language = targetLanguage(profileId)
  const positions = useMemo(() => blockPositions(chapter), [chapter])
  const marked = useMemo(() => highlights(chapter, material.id, profile.keeps, language), [chapter, material.id, profile.keeps, language])
  const pagedMaterial = material.kind === 'epub' || material.kind === 'pdf'
  const ready = chapter.segmentation === 'ready' && (pagedMaterial || material.chapters.every(item => item.segmentation === 'ready'))
  const pagination = useReaderPagination(viewport, chapterId, ready)
  const moveTo = (blockId: string, _offset = 0, textOffset?: number) => pagination.locate(blockId, textOffset)
  useEffect(() => {
    if (pendingChapter.current?.id === chapter.id) return
    const timer = setTimeout(() => {
      if (pendingChapter.current?.id === chapter.id) return
      if (restorePosition.current?.chapterId === chapter.id) {
        moveTo(restorePosition.current.blockId, restorePosition.current.offset, restorePosition.current.textOffset); restorePosition.current = undefined
      } else if (jumpPending.current && jump?.chapterId === chapter.id) {
        try {
          const verified = makeSelection(material.id, chapter, jump.spans, jump.combined, language)
          if (verified.text !== jump.text) throw new Error(t("无法定位原文"))
          setSelection(verified); moveTo(jump.blockId, 0, jump.spans[0].start); setTemporary(true); jumpPending.current = false
        } catch { report(new Error(t("无法定位原文，已打开来源材料"))) }
      } else if (material.progress?.chapterId === chapter.id) moveTo(material.progress.blockId, material.progress.offset, material.progress.textOffset)
      else if (viewport.current) pagination.showPage(0)
    }, 0)
    return () => clearTimeout(timer)
  }, [chapterId, jump, ready])
  const saveProgress = () => {
    const progress = lastProgress.current
    if (progress) void invoke({ type: 'progress', profile: profileId, materialId: material.id, progress }).then(apply).catch(report)
    lastProgress.current = undefined
  }
  useEffect(() => {
    if (!ready || !pagination.size.width || pendingChapter.current?.id !== chapter.id) return
    const animationFrame = window.requestAnimationFrame(() => {
      const pending = pendingChapter.current
      if (pending?.id !== chapter.id) return
      if (pending.edge === 'end' && [...(viewport.current?.querySelectorAll('img') || [])].some(image => !image.complete)) return
      pagination.showPage(pending.edge === 'end' ? Number.MAX_SAFE_INTEGER : 0)
      pendingChapter.current = undefined; setChapterTransition(false)
      if (pending.edge === 'end') {
        const position = pagination.location()
        if (position) { lastProgress.current = { chapterId: chapter.id, ...position }; saveProgress() }
      }
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [chapter.id, ready, pagination.size.width, pagination.size.height, pagination.pageCount, pagination.revision])
  useEffect(() => () => { saveProgress() }, [])
  useEffect(() => () => pronunciation.stop(), [])
  useEffect(() => { onSelection(selection) }, [selection])
  function changeChapter(id: string, edge: 'start' | 'end' = 'start') {
    const destination = material.chapters.find(item => item.id === id)
    if (!destination) return
    pronunciation.stop()
    saveProgress()
    pendingChapter.current = { id, edge }; setChapterTransition(true)
    setChapterId(id); setSelection(undefined); setFragments([]); setTemporary(false)
    const block = edge === 'end' ? destination.blocks.at(-1) : destination.blocks[0]
    if (block && (edge === 'start' || destination.segmentation !== 'ready')) { lastProgress.current = { chapterId: id, blockId: block.id, offset: 0 }; saveProgress() }
  }
  function turnPage(target: number) {
    if (pendingChapter.current) return
    if (target < 0) {
      const previous = material.chapters[chapterIndex - 1]
      if (previous) changeChapter(previous.id, 'end')
      return
    }
    if (target >= pagination.pageCount) {
      const next = material.chapters[chapterIndex + 1]
      if (next) changeChapter(next.id)
      return
    }
    pagination.showPage(target)
    const position = pagination.location()
    if (position) { setTemporary(false); lastProgress.current = { chapterId: chapter.id, ...position }; saveProgress() }
  }
  function choose(spans: Span[], combined = false) {
    try { lookup(makeSelection(material.id, chapter, spans, combined, language)) } catch (error) { report(error) }
  }
  function lookup(selected: Selection) {
    if (lookupCollapsed) moveTo(selected.blockId, 0, selected.spans[0].start)
    setLookupCollapsed(false)
    setSelection(selected)
    void pronunciation.play(selected, profileId).catch(() => console.warn('[LingKeep] pronunciation unavailable'))
  }
  function clickWord(span: Span) {
    if (draggedSelection.current || window.getSelection()?.toString()) return
    if (combine) setFragments(previous => previous.some(item => item.start < span.end && item.end > span.start) ? previous.filter(item => item.start >= span.end || item.end <= span.start) : [...previous, span].sort((a, b) => a.start - b.start))
    else choose([span])
  }
  function clickReadingBlank(event: MouseEvent<HTMLElement>) {
    if (draggedSelection.current || !(event.target instanceof Element) || event.target.closest('.word,button,a,input,textarea,select,[role="button"]')) return
    setSelection(undefined); setFragments([])
    window.getSelection()?.removeAllRanges()
    pronunciation.stop()
  }
  function selectedRange() {
    const native = window.getSelection()
    if (!native || native.isCollapsed || !native.anchorNode || !native.focusNode || !viewport.current?.contains(native.anchorNode) || !viewport.current.contains(native.focusNode)) return
    const position = (node: Node, offset: number): number | undefined => {
      const parent = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element)?.closest<HTMLElement>('[data-start]')
      if (!parent) return undefined
      const range = document.createRange(); range.selectNodeContents(parent); range.setEnd(node, offset)
      return Number(parent.dataset.start) + range.toString().length
    }
    const anchor = position(native.anchorNode, native.anchorOffset), focus = position(native.focusNode, native.focusOffset)
    if (anchor === undefined || focus === undefined || anchor === focus) return
    const expanded = expandSelectionToWords(chapter, { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }, language)
    const elements = [...viewport.current.querySelectorAll<HTMLElement>('[data-start]')]
    const start = elements.find(element => Number(element.dataset.start) <= expanded.start && Number(element.dataset.end) > expanded.start)
    const end = elements.find(element => Number(element.dataset.start) < expanded.end && Number(element.dataset.end) >= expanded.end)
    if (start?.firstChild && end?.firstChild) {
      const range = document.createRange()
      range.setStart(start.firstChild, expanded.start - Number(start.dataset.start))
      range.setEnd(end.firstChild, expanded.end - Number(end.dataset.start))
      native.removeAllRanges(); native.addRange(range)
    }
    draggedSelection.current = true
    if (combine) {
      setFragments(previous => {
        const sorted = [...previous, expanded].sort((a, b) => a.start - b.start)
        const merged: Span[] = []
        for (const span of sorted) {
          const last = merged.at(-1)
          if (last && span.start < last.end) last.end = Math.max(last.end, span.end)
          else merged.push({ ...span })
        }
        return merged
      })
      native.removeAllRanges()
    } else choose([expanded])
  }
  async function run(command: Record<string, unknown>) {
    setBusy(true)
    try { apply(await invoke({ ...command, type: String(command.type), profile: profileId, materialId: material.id })) } catch (error) { report(error) } finally { setBusy(false) }
  }
  return <section className="reader-shell">
    <header className="reader-toolbar"><button className="text-button" onClick={back}>{t('← Library')}</button><strong>{material.title}</strong><div className="row">
      {material.kind === 'url' && <button onClick={() => void invoke({ type: 'openURL', url: material.source }).catch(report)}>{t("原网页 ↗")}</button>}
      {material.chapters.some(chapter => chapter.blocks.some(block => block.image?.missing)) && <button disabled={busy} onClick={() => void run({ type: 'images' })}>{t("重试全部缺失图片")}</button>}
      <button aria-pressed={combine} disabled={!ready} onClick={() => { setCombine(!combine); setFragments([]); window.getSelection()?.removeAllRanges() }}>{combine ? t("取消组合") : t("组合选词")}</button>
      {combine && <button className="primary" disabled={!fragments.length} onClick={() => { choose(fragments, true); setCombine(false); setFragments([]) }}>{t('完成（{count}）', { count: fragments.length })}</button>}
      {temporary && <button onClick={() => { setTemporary(false); setSelection(undefined); const progress = originalProgress.current; if (progress) { restorePosition.current = progress; if (progress.chapterId === chapter.id) { moveTo(progress.blockId, progress.offset, progress.textOffset); restorePosition.current = undefined } else setChapterId(progress.chapterId) } else { restorePosition.current = { chapterId: material.chapters[0].id, blockId: material.chapters[0].blocks[0]?.id || '', offset: 0 }; if (chapter.id === material.chapters[0].id && viewport.current) { pagination.showPage(0); restorePosition.current = undefined } else setChapterId(material.chapters[0].id) } }}>{t("返回阅读位置")}</button>}
      <div className="reader-chapter-menu"><AppSelect aria-label={t("章节")} triggerLabel={t("章节")} menuMinWidth={CHAPTER_MENU_MIN_WIDTH} value={chapter.id} onValueChange={changeChapter}>{material.chapters.map(item => <option key={item.id} value={item.id}>{item.title}{item.segmentation !== 'ready' ? t(" · 待分词") : ''}</option>)}</AppSelect></div>
    </div></header>
    <div className="reader-columns"><section className="reading-pane" onMouseDownCapture={() => { draggedSelection.current = false }} onClick={clickReadingBlank}>

      {!ready ? <div className="empty"><h2>{t("待分词")}</h2><p>{chapter.error ? t(chapter.error) : t("中文正文已保存。完成分词后即可点击完整词语阅读。")}</p><div className="row"><button className="primary" disabled={busy} onClick={() => void run({ type: 'segment', chapterId: pagedMaterial ? chapter.id : undefined })}>{busy ? t("正在分词…") : t("处理 / 重试分词")}</button><button onClick={settings}>{t("配置 AI")}</button></div></div> : <>
        {language === 'zh' && selection && <div className="boundary-tools"><span>{t("修正划选范围的分词")}</span><button onClick={() => void run({ type: 'boundaries', selection, split: false })}>{t("合并为词")}</button><button onClick={() => void run({ type: 'boundaries', selection, split: true })}>{t("逐字拆分")}</button></div>}
        <div className="reader-page-stage">
        <button className="reader-page-arrow previous" aria-label={t('上一页')} title={t('上一页')} disabled={chapterTransition || (pagination.page === 0 && chapterIndex === 0)} onClick={() => turnPage(pagination.page - 1)}>
          <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 6-6 6 6 6" /></svg>
        </button>
        <div className="reader-content paginated-reader" ref={viewport} onMouseUp={selectedRange} onKeyDown={event => {
          if (event.target !== event.currentTarget || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
          if (event.key === 'PageDown' || event.key === 'ArrowRight') { event.preventDefault(); turnPage(pagination.page + 1) }
          if (event.key === 'PageUp' || event.key === 'ArrowLeft') { event.preventDefault(); turnPage(pagination.page - 1) }
        }} tabIndex={0} aria-label={t("学习材料正文")}>
          <div className="reader-pages" onLoadCapture={pagination.refresh} onErrorCapture={pagination.refresh} style={{ columnWidth: `${Math.max(1, pagination.size.width - READER_PAGE_PADDING * 2)}px`, columnGap: READER_PAGE_PADDING * 2, padding: READER_PAGE_PADDING, height: pagination.size.height || '100%', '--reader-page-height': `${pagination.size.height}px` } as CSSProperties}>
          {positions.map(({ block, offset }) => <ReadingBlock key={block.id} block={block} offset={offset} language={language} marks={marked} selected={selection?.spans || []} fragments={fragments} clicked={clickWord} retry={() => void run({ type: 'images', blockId: block.id })} />)}
          </div>
        </div>
        <button className="reader-page-arrow next" aria-label={t('下一页')} title={t('下一页')} disabled={chapterTransition || (pagination.page + 1 >= pagination.pageCount && chapterIndex === material.chapters.length - 1)} onClick={() => turnPage(pagination.page + 1)}>
          <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m10 6 6 6-6 6" /></svg>
        </button>
        <SelectionFrame viewport={viewport} selection={selection} page={pagination.page} width={pagination.size.width} height={pagination.size.height} revision={pagination.revision} />
        </div>
        <nav className="reader-pagination" aria-label={t('阅读分页')}>
          <span role="status" aria-live="polite">{t('第 {page} / {total} 页', { page: pagination.page + 1, total: pagination.pageCount })}</span>
        </nav>

      </>}
    </section>
    <div className={`lookup-panel${lookupCollapsed ? ' is-collapsed' : ''}`}>
      <button type="button" className="lookup-panel-toggle" aria-label={t(lookupCollapsed ? '展开查词' : '收起查词')} title={t(lookupCollapsed ? '展开查词' : '收起查词')} aria-expanded={!lookupCollapsed} aria-controls={lookupPanelId} onClick={() => setLookupCollapsed(previous => !previous)}><StatusIcon name={lookupCollapsed ? 'chevronLeft' : 'chevronRight'} /></button>
      <div id={lookupPanelId} className="lookup-panel-content" hidden={lookupCollapsed}>
      {selection && ready ? <MeaningSidebar key={`${profileId}:${selectionKey(selection)}`} selection={selection} profileId={profileId} profile={profile} apply={apply} settings={settings} choose={lookup} /> : <aside className="meaning-sidebar placeholder"><span className="empty-icon">Aa</span><h2>{t("读懂，也记住")}</h2><p>{t("点击单词查看释义。")}<br />{t("拖动划选短语或句子，")}<br />{t("也可以组合不连续的词。")}</p></aside>}
      </div>
    </div>
    </div>
  </section>
}
function ReadingBlock({ block, offset, language, marks, selected, fragments, clicked, retry }: { block: Block; offset: number; language: string; marks: Span[]; selected: Span[]; fragments: Span[]; clicked(span: Span): void; retry(): void }) {
  const { t } = useI18n()
  if (block.image) return <figure data-block={block.id}>{block.image.asset ? <img src={`ling-asset://local/${block.image.asset}`} alt={block.image.caption} /> : <div className="missing-image">{t("图片缺失")}<button onClick={retry}>{t("重试此图片")}</button></div>}<figcaption>{block.image.caption}</figcaption></figure>
  const words = language === 'zh' ? block.tokens.filter(span => /[\p{L}\p{N}]/u.test(block.text.slice(span.start, span.end))) : wordSpans(block.text, language)
  const cuts = new Set([0, block.text.length, ...words.flatMap(span => [span.start, span.end]), ...block.emphasis.flatMap(span => [span.start, span.end])])
  for (const span of [...marks, ...selected, ...fragments]) { if (span.start > offset && span.start < offset + block.text.length) cuts.add(span.start - offset); if (span.end > offset && span.end < offset + block.text.length) cuts.add(span.end - offset) }
  const points = [...cuts].sort((a, b) => a - b)
  return <div data-block={block.id} className={`reading-block ${block.kind}`}>{points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]; const globalStart = start + offset; const globalEnd = end + offset
    const word = words.find(word => word.start <= start && word.end >= end)
    const overlap = (spans: Span[]) => spans.some(span => span.start < globalEnd && span.end > globalStart)
    const bold = block.emphasis.some(span => span.kind === 'bold' && span.start < end && span.end > start)
    const italic = block.emphasis.some(span => span.kind === 'italic' && span.start < end && span.end > start)
    return <span key={start} data-start={globalStart} data-end={globalEnd} className={`${word ? 'word' : ''} ${overlap(marks) ? 'kept' : ''} ${overlap(selected) ? 'current' : ''} ${overlap(fragments) ? 'fragment' : ''}`} style={{ fontWeight: bold ? 700 : undefined, fontStyle: italic ? 'italic' : undefined }} onClick={() => { if (word) clicked({ start: word.start + offset, end: word.end + offset }) }}>{block.text.slice(start, end)}</span>
  })}</div>
}
