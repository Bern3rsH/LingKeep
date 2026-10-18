import { randomUUID } from 'node:crypto'
import { createEmptyCard } from 'ts-fsrs'
import { Store } from './store'
import { publicAI } from './ai'
import { verifiedSelection } from './queries'
import { adjustBoundaries, blockPositions, keepForSelection } from '../shared/reading'
import { editNoteDraft, validNoteRanges } from '../shared/note'
import { normalize, selectionKey, type ProfileId, type Material, type Selection, type Meaning, type Snapshot, type State, type SavedCard, type Span } from '../shared/domain'

const INITIAL_KEEP_LEVEL = 1

export const initialCard = (now = new Date()): SavedCard => {
  const card = createEmptyCard(now)
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() }
}
export function snapshot(state: State): Snapshot {
  return { interfaceLanguage: state.interfaceLanguage, activeProfile: state.activeProfile, profile: state.activeProfile ? state.profiles[state.activeProfile] : null, ai: publicAI(state.ai) }
}
export function defaultMeaning(state: State, profile: ProfileId, selection: Selection): Meaning | undefined {
  const data = state.profiles[profile]
  const binding = data.bindings[selectionKey(selection)]
  if (binding) return binding
  return [...data.keeps].filter(keep => normalize(keep.selection.text) === normalize(selection.text)).sort((a, b) => b.meaningUpdatedAt.localeCompare(a.meaningUpdatedAt))[0]?.meaning
}
export class Learning {
  constructor(readonly store: Store) {}
  async profile(profile: ProfileId): Promise<void> { await this.store.update(state => { state.activeProfile = profile }) }
  async addMaterial(profile: ProfileId, material: Material, copy = false): Promise<string | undefined> {
    return this.store.update(state => {
      const data = state.profiles[profile]
      // Retried confirmation of the same preview is idempotent even when importing a copy.
      if (data.materials.some(item => item.id === material.id)) return undefined
      const duplicate = data.materials.find(item => item.kind === material.kind && item.fingerprint === material.fingerprint)
      if (duplicate && !copy) return duplicate.id
      data.materials.unshift(structuredClone(material))
      return undefined
    })
  }
  async bind(profile: ProfileId, input: Selection, meaning: Meaning): Promise<void> {
    await this.store.update(state => {
      const selection = verifiedSelection(state, profile, input)
      state.profiles[profile].bindings[selectionKey(selection)] = meaning
      const keep = keepForSelection(selection, state.profiles[profile].keeps)
      if (keep) { keep.meaning = meaning; keep.updatedAt = new Date().toISOString(); keep.meaningUpdatedAt = keep.updatedAt }
    })
  }
  async contextNote(profile: ProfileId, input: Selection, note: string, noteAI?: Span[]): Promise<void> {
    await this.store.update(state => {
      const data = state.profiles[profile]
      const selection = verifiedSelection(state, profile, input)
      const key = selectionKey(selection)
      const keep = keepForSelection(selection, data.keeps)
      const ranges = noteAI ?? editNoteDraft({ text: keep?.note ?? data.contextNotes[key] ?? '', ai: keep?.noteAI ?? data.contextNoteAI?.[key] ?? [] }, note).ai
      if (!validNoteRanges(note, ranges)) throw new Error('笔记 AI 来源范围无效')
      if (keep) {
        keep.note = note; keep.updatedAt = new Date().toISOString()
        if (ranges.length) keep.noteAI = ranges
        else delete keep.noteAI
        delete data.contextNotes[key]
        if (data.contextNoteAI) delete data.contextNoteAI[key]
      } else {
        if (note) data.contextNotes[key] = note
        else delete data.contextNotes[key]
        if (ranges.length) { data.contextNoteAI ??= {}; data.contextNoteAI[key] = ranges }
        else if (data.contextNoteAI) delete data.contextNoteAI[key]
      }
    })
  }
  async selectMeaning(profile: ProfileId, input: Selection, meaning: Meaning): Promise<void> {
    if (!meaning.text.trim()) throw new Error('请选择或填写释义')
    await this.status(profile, input, INITIAL_KEEP_LEVEL, meaning, true)
  }
  async status(profile: ProfileId, input: Selection, level: number, meaning?: Meaning, preserveActiveLevel = false): Promise<void> {
    await this.store.update(state => {
      const data = state.profiles[profile]
      const selection = verifiedSelection(state, profile, input)
      let keep = keepForSelection(selection, data.keeps)
      if (level === 0) { if (keep) keep.active = false; return }
      if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error('记忆状态无效')
      const binding = meaning?.text.trim() ? meaning : defaultMeaning(state, profile, selection)
      if (!binding?.text.trim()) throw new Error('请选择或填写释义')
      data.bindings[selectionKey(selection)] = binding
      const now = new Date().toISOString()
      if (keep) { keep.meaning = binding; keep.level = preserveActiveLevel && keep.active ? keep.level : level; keep.active = true; keep.updatedAt = now; keep.meaningUpdatedAt = now }
      else {
        keep = { id: randomUUID(), selection, meaning: binding, active: true, level, note: data.contextNotes[selectionKey(selection)] || '', card: initialCard(), reviews: [], updatedAt: now, meaningUpdatedAt: now }
        const ranges = data.contextNoteAI?.[selectionKey(selection)]
        if (ranges?.length) keep.noteAI = ranges
        data.keeps.push(keep)
        delete data.contextNotes[selectionKey(selection)]
        if (data.contextNoteAI) delete data.contextNoteAI[selectionKey(selection)]
      }
    })
  }
  async editKeep(profile: ProfileId, id: string, changes: { note?: string; noteAI?: Span[]; meaning?: Meaning; level?: number; active?: boolean }): Promise<void> {
    await this.store.update(state => {
      const keep = state.profiles[profile].keeps.find(item => item.id === id)
      if (!keep) throw new Error('Keep 不存在')
      if (changes.level !== undefined && (!Number.isInteger(changes.level) || changes.level < 1 || changes.level > 5)) throw new Error('记忆状态无效')
      if (changes.meaning !== undefined && !changes.meaning.text.trim()) throw new Error('释义不能为空')
      const ranges = changes.noteAI ?? editNoteDraft({ text: keep.note, ai: keep.noteAI ?? [] }, changes.note ?? keep.note).ai
      if (!validNoteRanges(changes.note ?? keep.note, ranges)) throw new Error('笔记 AI 来源范围无效')
      Object.assign(keep, changes, { updatedAt: new Date().toISOString() })
      if (ranges.length) keep.noteAI = ranges
      else delete keep.noteAI
      if (changes.meaning) { state.profiles[profile].bindings[selectionKey(keep.selection)] = changes.meaning; keep.meaningUpdatedAt = keep.updatedAt }
    })
  }
  async batchKeeps(profile: ProfileId, ids: string[], changes: { level?: number; active?: boolean }): Promise<void> {
    if (!ids.length) throw new Error('请先选择 Keep')
    if (changes.level !== undefined && (!Number.isInteger(changes.level) || changes.level < 1 || changes.level > 5)) throw new Error('记忆状态无效')
    if ((changes.active !== undefined && typeof changes.active !== 'boolean') || (changes.level === undefined && changes.active === undefined)) throw new Error('批量操作无效')
    await this.store.update(state => {
      const selectedIds = new Set(ids)
      const keeps = state.profiles[profile].keeps.filter(keep => selectedIds.has(keep.id))
      if (keeps.length !== selectedIds.size) throw new Error('部分 Keep 不存在，请刷新后重试')
      const updatedAt = new Date().toISOString()
      for (const keep of keeps) {
        if (changes.level !== undefined) keep.level = changes.level
        if (changes.active !== undefined) keep.active = changes.active
        keep.updatedAt = updatedAt
      }
    })
  }
  async deleteKeeps(profile: ProfileId, ids: string[]): Promise<void> {
    if (!ids.length) throw new Error('请先选择 Keep')
    await this.store.update(state => {
      const data = state.profiles[profile]
      const selectedIds = new Set(ids)
      const keeps = data.keeps.filter(keep => selectedIds.has(keep.id))
      if (keeps.length !== selectedIds.size) throw new Error('部分 Keep 不存在，请刷新后重试')
      for (const keep of keeps) {
        const key = selectionKey(keep.selection)
        delete data.bindings[key]
        delete data.contextNotes[key]
        if (data.contextNoteAI) delete data.contextNoteAI[key]
      }
      data.keeps = data.keeps.filter(keep => !selectedIds.has(keep.id))
    })
  }
  async rename(profile: ProfileId, id: string, title: string): Promise<void> {
    if (!title.trim()) throw new Error('标题不能为空')
    await this.store.update(state => {
      const material = state.profiles[profile].materials.find(item => item.id === id)
      if (!material) throw new Error('材料不存在')
      material.title = title.trim()
    })
  }
  async removeMaterial(profile: ProfileId, id: string): Promise<void> {
    await this.store.update(state => { const data = state.profiles[profile]; data.materials = data.materials.filter(item => item.id !== id) })
  }
  async progress(profile: ProfileId, id: string, progress: NonNullable<Material['progress']>): Promise<void> {
    await this.store.update(state => {
      const material = state.profiles[profile].materials.find(item => item.id === id)
      const chapter = material?.chapters.find(item => item.id === progress.chapterId)
      const block = chapter && blockPositions(chapter).find(item => item.block.id === progress.blockId)
      if (!block || progress.textOffset !== undefined && (!Number.isInteger(progress.textOffset) || progress.textOffset < block.offset || progress.textOffset >= block.offset + block.block.text.length)) throw new Error('阅读位置无效')
      material!.progress = progress
    })
  }
  async boundaries(profile: ProfileId, input: Selection, split: boolean): Promise<void> {
    await this.store.update(state => {
      if (profile !== 'en-zh') throw new Error('仅中文材料需要修正分词')
      const selection = verifiedSelection(state, profile, input)
      if (selection.spans.length !== 1) throw new Error('请连续划选需要修正的文字')
      const chapter = state.profiles[profile].materials.find(item => item.id === selection.materialId)!.chapters.find(item => item.id === selection.chapterId)!
      const range = selection.spans[0]
      const position = blockPositions(chapter).find(({ block, offset }) => range.start >= offset && range.end <= offset + block.text.length)
      if (!position) throw new Error('请在同一段落内修正分词边界')
      position.block.tokens = adjustBoundaries(position.block, { start: range.start - position.offset, end: range.end - position.offset }, split)
    })
  }
}
