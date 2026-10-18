import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { SpeechService } from './speech'
import { pronunciationText } from '../shared/pronunciation'
import { Store } from './store'
import { AI, isConfigured, ollamaURL } from './ai'
import { Importer, firstImageAsset, importText } from './imports'
import { Dictionaries } from './dictionary'
import { Learning, snapshot, defaultMeaning } from './learning'
import { Queries, verifiedSelection } from './queries'
import { Reviews } from './review'
import { MAX_INPUT, interfaceLanguages, meaningSchema, profileIds, providers, selectionSchema, materialSchema, spanSchema, targetLanguage, type Command, type Material, type ProfileId, type Result } from '../shared/domain'

const text = z.string().max(MAX_INPUT)
const id = z.string().min(1).max(200)
const profile = z.enum(profileIds)
const schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot') }),
  z.object({ type: z.literal('profile'), profile }),
  z.object({ type: z.literal('interfaceLanguage'), language: z.enum(interfaceLanguages).nullable() }),
  z.object({ type: z.literal('preview'), profile, kind: z.enum(['text', 'url', 'epub', 'pdf']), title: text, input: text }),
  z.object({ type: z.literal('import'), profile, previewId: id, title: text, blockIds: z.array(id), copy: z.boolean() }),
  z.object({ type: z.literal('rename'), profile, materialId: id, title: text }),
  z.object({ type: z.literal('removeMaterial'), profile, materialId: id }),
  z.object({ type: z.literal('progress'), profile, materialId: id, progress: materialSchema.shape.progress.unwrap() }),
  z.object({ type: z.literal('segment'), profile, materialId: id, chapterId: id.optional() }),
  z.object({ type: z.literal('images'), profile, materialId: id, blockId: id.optional() }),
  z.object({ type: z.literal('lookup'), profile, selection: selectionSchema }),
  z.object({ type: z.literal('pronounce'), profile, selection: selectionSchema }),
  z.object({ type: z.literal('explain'), profile, selection: selectionSchema, regenerate: z.boolean().default(false) }),
  z.object({ type: z.literal('explainNote'), profile, selection: selectionSchema }),
  z.object({ type: z.literal('binding'), profile, selection: selectionSchema }),
  z.object({ type: z.literal('bind'), profile, selection: selectionSchema, meaning: meaningSchema }),
  z.object({ type: z.literal('selectMeaning'), profile, selection: selectionSchema, meaning: meaningSchema }),
  z.object({ type: z.literal('contextNote'), profile, selection: selectionSchema, note: text, noteAI: z.array(spanSchema).optional() }),
  z.object({ type: z.literal('status'), profile, selection: selectionSchema, level: z.number().int().min(0).max(5), meaning: meaningSchema.optional() }),
  z.object({ type: z.literal('editKeep'), profile, keepId: id, changes: z.object({ note: text.optional(), noteAI: z.array(spanSchema).optional(), meaning: meaningSchema.optional(), level: z.number().int().min(1).max(5).optional(), active: z.boolean().optional() }) }),
  z.object({ type: z.literal('batchKeeps'), profile, keepIds: z.array(id).min(1), changes: z.object({ level: z.number().int().min(1).max(5).optional(), active: z.boolean().optional() }).strict().refine(changes => changes.level !== undefined || changes.active !== undefined) }),
  z.object({ type: z.literal('deleteKeeps'), profile, keepIds: z.array(id).min(1) }),
  z.object({ type: z.literal('boundaries'), profile, selection: selectionSchema, split: z.boolean() }),
  z.object({ type: z.literal('review'), profile, keepId: id, rating: z.enum(['Again', 'Hard', 'Good']), operationId: z.string().uuid() }),
  z.object({ type: z.literal('models'), provider: z.enum(providers), key: text.optional(), ollamaBaseUrl: text.optional() }),
  z.object({ type: z.literal('settings'), provider: z.enum(providers), key: text.optional(), removeKey: z.boolean().optional(), model: z.string().max(300), ollamaBaseUrl: z.string().max(2000) }),
  z.object({ type: z.literal('openURL'), url: z.string().max(4000) })
])
export class Application {
  readonly learning: Learning
  readonly queries: Queries
  readonly reviews: Reviews
  private previews = new Map<string, { profile: ProfileId; material: Material }>()
  private coversReady: Promise<void> | undefined
  constructor(readonly store: Store, readonly importer: Importer, readonly dictionaries: Dictionaries, readonly ai: AI,
    readonly chooseFile: (kind: 'epub' | 'pdf') => Promise<string | undefined>, readonly openURL: (url: string) => Promise<void>, readonly speech = new SpeechService(join(importer.assetsDirectory, '..', 'tts_cache'))) {
    this.learning = new Learning(store); this.queries = new Queries(store, ai); this.reviews = new Reviews(store)
  }
  async command(input: Command): Promise<Result> {
    const result = await this.dispatch(input)
    if (result.snapshot) result.snapshot.notice = this.store.takeRecoveryNotice()
    return result
  }
  private async restoreCovers(): Promise<void> {
    const state = await this.store.read()
    const covers: { profile: ProfileId; materialId: string; cover: string }[] = []
    for (const profile of profileIds) for (const material of state.profiles[profile].materials) {
      if (material.cover || !['epub', 'url'].includes(material.kind)) continue
      const cover = material.kind === 'url' ? firstImageAsset(material) : await this.importer.restoreCover(material)
      if (cover) covers.push({ profile, materialId: material.id, cover })
    }
    if (covers.length) await this.store.update(current => {
      for (const item of covers) {
        const material = current.profiles[item.profile].materials.find(material => material.id === item.materialId)
        if (material && !material.cover) material.cover = item.cover
      }
    })
  }
  private async dispatch(input: Command): Promise<Result> {
    const command = schema.parse(input)
    if (command.type === 'snapshot') {
      this.coversReady ??= this.restoreCovers().catch(() => { this.coversReady = undefined; console.warn('[LingKeep] material cover recovery failed') })
      await this.coversReady
      return { snapshot: snapshot(await this.store.read()) }
    }
    if (command.type === 'openURL') {
      const url = new URL(command.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('不支持的网址')
      await this.openURL(url.href); return {}
    }
    if (command.type === 'profile') await this.learning.profile(command.profile)
    else if (command.type === 'interfaceLanguage') await this.store.update(state => { state.interfaceLanguage = command.language })
    else if (command.type === 'preview') {
      let material: Material
      if (command.kind === 'text') material = importText(command.input, command.title, command.profile)
      else if (command.kind === 'url') material = await this.importer.web(command.input, command.title, command.profile)
      else { const path = await this.chooseFile(command.kind); if (!path) return {}; material = command.kind === 'pdf' ? await this.importer.pdf(path, command.profile) : await this.importer.epub(path, command.profile) }
      if (command.kind === 'pdf' && command.title.trim()) material.title = command.title.trim()
      const token = randomUUID()
      this.previews.set(token, { profile: command.profile, material })
      while (this.previews.size > 10) this.previews.delete(this.previews.keys().next().value!)
      // The preview token travels as duplicateId; it never exposes a native path.
      return { material, duplicateId: token }
    } else if (command.type === 'import') {
      const preview = this.previews.get(command.previewId)
      if (!preview || preview.profile !== command.profile) throw new Error('预览已过期，请重新提取')
      const material = structuredClone(preview.material)
      material.title = command.title.trim() || material.title
      const selected = new Set(command.blockIds)
      for (const chapter of material.chapters) chapter.blocks = chapter.blocks.filter(block => selected.has(block.id))
      if (material.kind === 'pdf') material.chapters = material.chapters.filter(chapter => chapter.blocks.length)
      if (material.kind === 'url') material.cover = firstImageAsset(material)
      if (!material.chapters.some(chapter => chapter.blocks.some(block => block.text.trim()))) throw new Error('请保留至少一段正文')
      const duplicateId = await this.learning.addMaterial(command.profile, material, command.copy)
      if (duplicateId) return { duplicateId }
      return { material, snapshot: snapshot(await this.store.read()) }
    } else if (command.type === 'rename') await this.learning.rename(command.profile, command.materialId, command.title)
    else if (command.type === 'removeMaterial') await this.learning.removeMaterial(command.profile, command.materialId)
    else if (command.type === 'progress') await this.learning.progress(command.profile, command.materialId, command.progress)
    else if (command.type === 'segment') await this.queries.segment(command.profile, command.materialId, command.chapterId)
    else if (command.type === 'images') {
      const state = await this.store.read()
      const material = state.profiles[command.profile].materials.find(item => item.id === command.materialId)
      if (!material) throw new Error('材料不存在')
      const blocks = material.chapters.flatMap(chapter => chapter.blocks).filter(block => block.image?.missing && (!command.blockId || block.id === command.blockId))
      for (const block of blocks) {
        await this.importer.retryImage(block)
        await this.store.update(current => {
          const saved = current.profiles[command.profile].materials.find(item => item.id === material.id)?.chapters.flatMap(chapter => chapter.blocks).find(item => item.id === block.id)
          if (saved) saved.image = block.image
          const savedMaterial = current.profiles[command.profile].materials.find(item => item.id === material.id)
          if (savedMaterial?.kind === 'url') savedMaterial.cover = firstImageAsset(savedMaterial)
        })
      }
      if (blocks.some(block => block.image?.missing)) throw new Error('部分图片仍未能保存，可继续阅读并稍后重试')
    } else if (command.type === 'lookup') {
      const selection = verifiedSelection(await this.store.read(), command.profile, command.selection)
      return { meanings: await this.dictionaries.lookup(selection.text, command.profile) }
    } else if (command.type === 'pronounce') {
      const selection = verifiedSelection(await this.store.read(), command.profile, command.selection)
      return { audio: await this.speech.audio(pronunciationText(selection), targetLanguage(command.profile)) }
    } else if (command.type === 'explain') return { meaning: await this.queries.explain(command.profile, command.selection, command.regenerate) }
    else if (command.type === 'explainNote') return { explanation: await this.queries.explainNote(command.profile, command.selection) }
    else if (command.type === 'binding') {
      const state = await this.store.read()
      const selection = verifiedSelection(state, command.profile, command.selection)
      return { meaning: defaultMeaning(state, command.profile, selection), configured: isConfigured(state.ai) }
    } else if (command.type === 'bind') await this.learning.bind(command.profile, command.selection, command.meaning)
    else if (command.type === 'selectMeaning') await this.learning.selectMeaning(command.profile, command.selection, command.meaning)
    else if (command.type === 'contextNote') await this.learning.contextNote(command.profile, command.selection, command.note, command.noteAI)
    else if (command.type === 'status') await this.learning.status(command.profile, command.selection, command.level, command.meaning)
    else if (command.type === 'editKeep') await this.learning.editKeep(command.profile, command.keepId, command.changes)
    else if (command.type === 'batchKeeps') await this.learning.batchKeeps(command.profile, command.keepIds, command.changes)
    else if (command.type === 'deleteKeeps') await this.learning.deleteKeeps(command.profile, command.keepIds)
    else if (command.type === 'boundaries') await this.learning.boundaries(command.profile, command.selection, command.split)
    else if (command.type === 'review') await this.reviews.grade(command.profile, command.keepId, command.rating, command.operationId)
    else if (command.type === 'models') {
      const config = (await this.store.read()).ai
      if (command.key?.trim()) config.configs[command.provider] = { key: command.key.trim(), model: config.configs[command.provider]?.model || '' }
      if (command.ollamaBaseUrl) config.ollamaBaseUrl = ollamaURL(command.ollamaBaseUrl)
      return { models: await this.ai.models(config, command.provider) }
    } else if (command.type === 'settings') {
      const url = ollamaURL(command.ollamaBaseUrl)
      await this.store.update(state => {
        const saved = state.ai.configs[command.provider] || { key: '', model: '' }
        if (command.removeKey) saved.key = ''
        else if (command.key?.trim()) saved.key = command.key.trim()
        saved.model = command.model.trim()
        state.ai.configs[command.provider] = saved
        state.ai.provider = command.provider; state.ai.ollamaBaseUrl = url
      })
    }
    return { snapshot: snapshot(await this.store.read()) }
  }
}
