import { z } from 'zod'

export const interfaceLanguages = ['zh', 'en'] as const
export type InterfaceLanguage = typeof interfaceLanguages[number]

export const profileIds = ['zh-en', 'en-zh', 'zh-fr', 'en-fr'] as const
export type LearningLanguage = 'zh' | 'en' | 'fr'
export const providers = ['google-gemini', 'openai', 'deepseek', 'openrouter', 'anthropic', 'ollama'] as const
export type ProfileId = typeof profileIds[number]
const profileLanguages = {
  'zh-en': { native: 'zh', learning: 'en' }, 'en-zh': { native: 'en', learning: 'zh' },
  'zh-fr': { native: 'zh', learning: 'fr' }, 'en-fr': { native: 'en', learning: 'fr' },
} as const
export const nativeLanguage = (profile: ProfileId) => profileLanguages[profile].native
export const targetLanguage = (profile: ProfileId) => profileLanguages[profile].learning
export type Provider = typeof providers[number]
export const providerLabels: Record<Provider, string> = {
  'google-gemini': 'Google Gemini', openai: 'OpenAI', deepseek: 'DeepSeek',
  openrouter: 'OpenRouter', anthropic: 'Anthropic / Claude', ollama: 'Ollama（本地）'
}
export const MAX_INPUT = 2_000_000
export const levels = [1, 2, 3, 4, 5] as const
export type Level = typeof levels[number]
export const levelLabels = ['忽略', '陌生', '有印象', '基本理解', '熟悉', '已掌握']
export const spanSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
export type Span = z.infer<typeof spanSchema>
export const blockSchema = z.object({
  id: z.string(), kind: z.enum(['paragraph', 'heading', 'list', 'quote', 'image']), text: z.string(),
  emphasis: z.array(z.object({ start: z.number(), end: z.number(), kind: z.enum(['bold', 'italic']) })).default([]),
  image: z.object({ source: z.string(), asset: z.string().optional(), missing: z.boolean(), caption: z.string() }).optional(),
  tokens: z.array(spanSchema).default([])
})
export type Block = z.infer<typeof blockSchema>
export const chapterSchema = z.object({
  id: z.string(), title: z.string(), blocks: z.array(blockSchema),
  segmentation: z.enum(['ready', 'pending']), error: z.string().optional()
})
export type Chapter = z.infer<typeof chapterSchema>
export const materialSchema = z.object({
  id: z.string(), title: z.string(), kind: z.enum(['text', 'url', 'epub', 'pdf']), source: z.string(),
  cover: z.string().regex(/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/).optional(),
  fingerprint: z.string(), chapters: z.array(chapterSchema), createdAt: z.string(),
  progress: z.object({ chapterId: z.string(), blockId: z.string(), offset: z.number().nonnegative(), textOffset: z.number().int().nonnegative().optional() }).optional()
})
export type Material = z.infer<typeof materialSchema>
export const selectionSchema = z.object({
  materialId: z.string(), chapterId: z.string(), blockId: z.string(),
  spans: z.array(spanSchema).min(1), combined: z.boolean(), text: z.string(), context: z.string()
})
export type Selection = z.infer<typeof selectionSchema>
export const meaningSchema = z.object({ text: z.string(), source: z.enum(['AI', 'dictionary', 'manual']) })
export type Meaning = z.infer<typeof meaningSchema>
export const cardSchema = z.object({
  due: z.string(), stability: z.number(), difficulty: z.number(), elapsed_days: z.number(),
  scheduled_days: z.number(), reps: z.number(), lapses: z.number(), state: z.number(),
  learning_steps: z.number(), last_review: z.string().optional()
})
export type SavedCard = z.infer<typeof cardSchema>
export const keepSchema = z.object({
  id: z.string(), selection: selectionSchema, meaning: meaningSchema, active: z.boolean(),
  level: z.number().int().min(1).max(5), note: z.string(), noteAI: z.array(spanSchema).optional(), card: cardSchema, updatedAt: z.string(),
  meaningUpdatedAt: z.string().default('1970-01-01T00:00:00.000Z'),
  reviews: z.array(z.object({ operationId: z.string(), at: z.string(), rating: z.enum(['Again', 'Hard', 'Good']), log: z.record(z.string(), z.unknown()) }))
})
export type Keep = z.infer<typeof keepSchema>
export const profileSchema = z.object({
  materials: z.array(materialSchema), keeps: z.array(keepSchema),
  contextNotes: z.record(z.string(), z.string()).default({}),
  contextNoteAI: z.record(z.string(), z.array(spanSchema)).optional(),
  aiCache: z.record(z.string(), meaningSchema), bindings: z.record(z.string(), meaningSchema)
})
export type Profile = z.infer<typeof profileSchema>
export function emptyProfile(): Profile { return { materials: [], keeps: [], contextNotes: {}, bindings: {}, aiCache: {} } }
export const aiConfigSchema = z.object({
  provider: z.enum(providers), ollamaBaseUrl: z.string(),
  configs: z.record(z.string(), z.object({ key: z.string(), model: z.string() }))
})
export type AIConfig = z.infer<typeof aiConfigSchema>
export const stateSchema = z.object({
  version: z.literal(1), activeProfile: z.enum(profileIds).nullable(),
  interfaceLanguage: z.enum(interfaceLanguages).nullable().default(null),
  ai: aiConfigSchema, profiles: z.object({ 'zh-en': profileSchema, 'en-zh': profileSchema, 'zh-fr': profileSchema.default(emptyProfile), 'en-fr': profileSchema.default(emptyProfile) })
})
export type State = z.infer<typeof stateSchema>
export type PublicAI = { provider: Provider; ollamaBaseUrl: string; configs: Partial<Record<Provider, { model: string; hasKey: boolean; source: 'app' | 'environment' | 'missing' }>> }
export type Snapshot = { interfaceLanguage?: InterfaceLanguage | null; activeProfile: ProfileId | null; profile: Profile | null; ai: PublicAI; notice?: string }
export type Result = { snapshot?: Snapshot; material?: Material; duplicateId?: string; meanings?: Meaning[]; models?: string[]; meaning?: Meaning; explanation?: string; audio?: { data: string; mimeType: 'audio/mpeg' }; configured?: boolean; error?: string }
export interface Command { type: string; [key: string]: unknown }
export interface Bridge {
  invoke(command: Command): Promise<Result>
  onCloseRequested(flush: () => Promise<boolean>): () => void
}

export function emptyState(): State {
  return { version: 1, activeProfile: null, interfaceLanguage: null, profiles: { 'zh-en': emptyProfile(), 'en-zh': emptyProfile(), 'zh-fr': emptyProfile(), 'en-fr': emptyProfile() },
    ai: { provider: 'google-gemini', ollamaBaseUrl: 'http://127.0.0.1:11434', configs: {} } }
}
export const normalize = (text: string) => text.toLocaleLowerCase('en-US')
export const selectionKey = (s: Selection) => JSON.stringify([s.materialId, s.chapterId, s.blockId, s.spans.map(span => [span.start, span.end])])
export const cacheKey = (s: Selection) => JSON.stringify([s.text, s.context, s.combined, s.spans])
