import { AI, isConfigured } from './ai'
import { Store } from './store'
import { cacheKey, targetLanguage, type Meaning, type ProfileId, type Selection } from '../shared/domain'
import { chapterText, makeSelection } from '../shared/reading'

export function verifiedSelection(state: Awaited<ReturnType<Store['read']>>, profile: ProfileId, selection: Selection): Selection {
  const material = state.profiles[profile].materials.find(item => item.id === selection.materialId)
  const chapter = material?.chapters.find(item => item.id === selection.chapterId)
  if (!chapter) throw new Error('来源材料已删除')
  if (chapter.segmentation !== 'ready') throw new Error('该章节待分词')
  return makeSelection(material!.id, chapter, selection.spans, selection.combined, targetLanguage(profile))
}
const AI_EXPLANATION_CACHE_VERSION = 'native-translation-pos-inflection-v4'
const NOTE_CONTEXT_PADDING = 600
const MAX_NOTE_CONTEXT_CHARACTERS = 12_000

export class Queries {
  private pending = new Map<string, Promise<Meaning>>()
  private segments = new Map<string, Promise<void>>()
  constructor(readonly store: Store, readonly ai: AI) {}
  async explainNote(profile: ProfileId, input: Selection): Promise<string> {
    const state = await this.store.read()
    const selection = verifiedSelection(state, profile, input)
    const chapter = state.profiles[profile].materials.find(material => material.id === selection.materialId)!.chapters.find(chapter => chapter.id === selection.chapterId)!
    const text = chapterText(chapter)
    const start = Math.max(0, selection.spans[0].start - NOTE_CONTEXT_PADDING)
    const end = Math.min(text.length, selection.spans.at(-1)!.end + NOTE_CONTEXT_PADDING, start + MAX_NOTE_CONTEXT_CHARACTERS)
    return this.ai.explainNote(state.ai, selection, profile, text.slice(start, end))
  }
  async explain(profile: ProfileId, input: Selection, regenerate = false): Promise<Meaning> {
    const state = await this.store.read()
    const selection = verifiedSelection(state, profile, input)
    const key = `${AI_EXPLANATION_CACHE_VERSION}:${cacheKey(selection)}`
    const requestKey = `${profile}:${key}`
    if (this.pending.has(requestKey)) return this.pending.get(requestKey)!
    if (!regenerate && state.profiles[profile].aiCache[key]) return state.profiles[profile].aiCache[key]
    if (!isConfigured(state.ai)) throw new Error('请先配置 AI')
    const promise = this.ai.explain(state.ai, selection, profile).then(async text => {
      const meaning: Meaning = { text, source: 'AI' }
      await this.store.update(current => { current.profiles[profile].aiCache[key] = meaning })
      return meaning
    }).finally(() => this.pending.delete(requestKey))
    this.pending.set(requestKey, promise)
    return promise
  }
  async segment(profile: ProfileId, materialId: string, chapterId?: string): Promise<void> {
    const key = `${profile}:${materialId}:${chapterId || '*'}`
    if (this.segments.has(key)) return this.segments.get(key)!
    const promise = this.segmentMaterial(profile, materialId, chapterId).finally(() => this.segments.delete(key))
    this.segments.set(key, promise)
    return promise
  }
  private async segmentMaterial(profile: ProfileId, materialId: string, chapterId?: string): Promise<void> {
    const initial = await this.store.read()
    const material = initial.profiles[profile].materials.find(item => item.id === materialId)
    if (!material) throw new Error('材料不存在')
    if (targetLanguage(profile) !== 'zh') return
    if (!isConfigured(initial.ai)) throw new Error('请先配置 AI；正文已保存为待分词')
    for (const chapter of material.chapters.filter(chapter => !chapterId || chapter.id === chapterId)) {
      if (chapter.segmentation === 'ready') continue
      try {
        for (const block of chapter.blocks) {
          if (block.tokens.length || !block.text) continue
          const tokens = await this.ai.segment(initial.ai, block.text)
          await this.store.update(state => {
            const current = state.profiles[profile].materials.find(item => item.id === materialId)?.chapters.find(item => item.id === chapter.id)?.blocks.find(item => item.id === block.id)
            if (!current) throw new Error('材料已删除')
            current.tokens = tokens
          })
        }
        await this.store.update(state => {
          const current = state.profiles[profile].materials.find(item => item.id === materialId)?.chapters.find(item => item.id === chapter.id)
          if (current) { current.segmentation = 'ready'; delete current.error }
        })
      } catch (error) {
        await this.store.update(state => {
          const current = state.profiles[profile].materials.find(item => item.id === materialId)?.chapters.find(item => item.id === chapter.id)
          if (current) current.error = error instanceof Error ? error.message : '分词失败'
        })
        throw error
      }
    }
  }
}
