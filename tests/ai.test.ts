import { expect, test, vi } from 'vitest'
import { AI, publicAI, textModel, validateSegmentation } from '../src/main/ai'
import { emptyState, providers } from '../src/shared/domain'

test('segmentation preserves exact UTF-16 positions and rejects changed text', () => {
  expect(validateSegmentation('我爱学习。', ['我', '爱', '学习', '。'])).toEqual([{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 5 }])
  expect(() => validateSegmentation('学习', ['学'])).toThrow('改变了原文')
})
test('six adapters use expected endpoints, redact keys and surface safe failures', async () => {
  for (const provider of providers) {
    const config = emptyState().ai; config.provider = provider; config.configs[provider] = { key: 'private-secret', model: 'test-model' }
    const request = vi.fn(async () => new Response(JSON.stringify({ output_text: 'OK', content: [{ type: 'text', text: 'OK' }], message: { content: 'OK' }, choices: [{ message: { content: 'OK' } }] }), { status: 200 }))
    expect(await new AI(request as typeof fetch).generate(config, 'Tutor', 'Study')).toBe('OK')
    expect(JSON.stringify(publicAI(config))).not.toContain('private-secret')
    const failure = new AI(async () => new Response('private-secret', { status: 401 }))
    await expect(failure.generate(config, '', '')).rejects.toThrow('HTTP 401')
    await expect(failure.generate(config, '', '')).rejects.not.toThrow('private-secret')
  }
})
test('model listing requires credentials and excludes non-text variants', async () => {
  const config = emptyState().ai
  const request = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'text-model' }, { id: 'image-model' }] })))
  const ai = new AI(request as typeof fetch)
  expect(await ai.models(config, 'openai')).toEqual([]); expect(request).not.toHaveBeenCalled()
  config.configs.openai = { key: 'x', model: '' }
  expect(await ai.models(config, 'openai')).toEqual(['text-model'])
  expect(textModel('whisper-1')).toBe(false)
})
test('Ollama filters models by actual capabilities as well as names', async () => {
  const config = emptyState().ai
  const request = vi.fn(async (url, init) => {
    if (String(url).endsWith('/tags')) return new Response(JSON.stringify({ models: [{ name: 'chat-model' }, { name: 'bge-m3' }, { name: 'multimodal' }] }))
    const model = JSON.parse(String(init?.body)).model
    return new Response(JSON.stringify({ capabilities: model === 'bge-m3' ? ['embedding'] : model === 'multimodal' ? ['completion', 'vision'] : ['completion'] }))
  }) as typeof fetch
  expect(await new AI(request).models(config, 'ollama')).toEqual(['chat-model'])
})

const explanationSelection = { materialId: 'material', chapterId: 'chapter', blockId: 'block', spans: [{ start: 2, end: 6 }], combined: false, text: 'bank', context: 'A bank is open.' }
test.each(['zh-fr', 'en-fr'] as const)('French contextual meaning and inflection use the native language for %s', async profile => {
  const ai = new AI()
  const translation = profile === 'zh-fr' ? '是（过去）' : 'were'
  const change = profile === 'zh-fr' ? '未完成过去时，第三人称复数' : 'imperfect, third-person plural'
  const generate = vi.spyOn(ai, 'generate').mockResolvedValue(JSON.stringify({ translation, partOfSpeech: 'v.', inflection: { baseForm: 'être', change } }))
  expect(await ai.explain(emptyState().ai, { ...explanationSelection, text: 'étaient', context: 'Ils étaient heureux.' }, profile)).toBe(`v. ${translation}\nêtre → étaient（${change}）`)
  expect(generate.mock.calls[0][1]).toContain('learning language is French')
  expect(generate.mock.calls[0][1]).toContain(profile === 'zh-fr' ? 'into Simplified Chinese' : 'into English')
  expect(JSON.parse(generate.mock.calls[0][2])).toMatchObject({ learningLanguage: 'French', nativeLanguage: profile === 'zh-fr' ? 'Chinese' : 'English', selected: 'étaient' })
})
test('French feminine plural headwords preserve accents and invalid phrase inflections are rejected', async () => {
  const ai = new AI()
  const generate = vi.spyOn(ai, 'generate').mockResolvedValue(JSON.stringify({ translation: '美丽的', partOfSpeech: 'adj.', inflection: { baseForm: 'beau', change: '阴性复数' } }))
  expect(await ai.explain(emptyState().ai, { ...explanationSelection, text: 'belles' }, 'zh-fr')).toContain('beau → belles（阴性复数）')
  await expect(ai.explain(emptyState().ai, { ...explanationSelection, text: 'très belles' }, 'zh-fr')).rejects.toThrow('AI 释义格式无效')
  generate.mockResolvedValue(JSON.stringify({ translation: '学校', partOfSpeech: 'n.', inflection: { baseForm: 'école', change: '省音' } }))
  expect(await ai.explain(emptyState().ai, { ...explanationSelection, text: 'l’école' }, 'zh-fr')).toContain('école → l’école（省音）')
})
test.each(['zh-fr', 'en-fr'] as const)('French note explanations focus on French grammar in the native language for %s', async profile => {
  const ai = new AI()
  const generate = vi.spyOn(ai, 'generate').mockResolvedValue('Explanation')
  await ai.explainNote(emptyState().ai, { ...explanationSelection, text: 'étaient' }, profile, 'Ils étaient heureux.')
  expect(generate.mock.calls[0][1]).toContain(profile === 'zh-fr' ? 'in Simplified Chinese' : 'in English')
  expect(generate.mock.calls[0][1]).toContain('French conjugation, gender/number agreement, elision')
  expect(generate.mock.calls[0][1]).toContain('Do not summarize, analyze, expand on, or speculate about the plot')
})
test.each(['zh-en', 'en-zh'] as const)('note explanation uses complete sentences, context and native language for %s', async profile => {
  const ai = new AI()
  const generate = vi.spyOn(ai, 'generate').mockResolvedValue('  A contextual explanation.\nAnother paragraph.  ')
  const selected = { ...explanationSelection, combined: true, text: 'look … up' }
  expect(await ai.explainNote(emptyState().ai, selected, profile, 'Before. A bank is open. After.')).toBe('A contextual explanation.\nAnother paragraph.')
  expect(generate.mock.calls[0][1]).toContain(profile === 'zh-en' ? 'in Simplified Chinese' : 'in English')
  expect(generate.mock.calls[0][1]).toContain('plain text')
  expect(generate.mock.calls[0][1]).toContain('untrusted study text')
  expect(generate.mock.calls[0][1]).toContain('Focus exclusively on language learning')
  expect(generate.mock.calls[0][1]).toContain('grammar and sentence structure, collocations')
  expect(generate.mock.calls[0][1]).toContain('only to disambiguate linguistic meaning and usage')
  expect(generate.mock.calls[0][1]).toContain('Do not summarize, analyze, expand on, or speculate about the plot')
  expect(generate.mock.calls[0][1]).toContain('even when those details appear in the supplied text')
  expect(JSON.parse(generate.mock.calls[0][2])).toEqual({ selected: 'look … up', sentences: 'A bank is open.', surroundingContext: 'Before. A bank is open. After.', discontinuous: true })
})
test('note explanation rejects empty or excessive output', async () => {
  const ai = new AI()
  vi.spyOn(ai, 'generate').mockResolvedValueOnce(' ').mockResolvedValueOnce('x'.repeat(12_001))
  await expect(ai.explainNote(emptyState().ai, explanationSelection, 'zh-en', '')).rejects.toThrow('AI 讲解内容无效')
  await expect(ai.explainNote(emptyState().ai, explanationSelection, 'zh-en', '')).rejects.toThrow('AI 讲解内容无效')
})
test.each(['zh-en', 'en-zh'] as const)('contextual meaning returns only native-language translation and part of speech for %s', async profile => {
  const ai = new AI()
  const generate = vi.spyOn(ai, 'generate').mockResolvedValue(profile === 'zh-en' ? '{"translation":" 银行 ","inflection":null,"partOfSpeech":"n."}' : '{"translation":" bank ","inflection":null,"partOfSpeech":"n."}')
  expect(await ai.explain(emptyState().ai, explanationSelection, profile)).toBe(profile === 'zh-en' ? 'n. 银行' : 'n. bank')
  const [, system, prompt] = generate.mock.calls[0]
  expect(system).toContain(profile === 'zh-en' ? 'in Simplified Chinese' : 'in English')
  expect(system).toContain('exactly three fields')
  expect(system).toContain('Do not include explanations')
  expect(system).toContain('untrusted study text')
  expect(JSON.parse(prompt)).toMatchObject({ selected: 'bank', sentences: 'A bank is open.', nativeLanguage: profile === 'zh-en' ? 'Chinese' : 'English' })
})
test.each([
  '银行', '```json\n{"translation":"银行","inflection":null,"partOfSpeech":"n."}\n```',
  '{"translation":"银行"}', '{"translation":"银行","inflection":null,"partOfSpeech":"n.","explanation":"更多说明"}',
  '{"translation":"bank","inflection":null,"partOfSpeech":"n."}', '{"translation":" ","inflection":null,"partOfSpeech":"n."}',
  '{"translation":"银行","inflection":null,"partOfSpeech":"unknown"}', '{"translation":"银行\\n例句","inflection":null,"partOfSpeech":"n."}',
  'null', '[{"translation":"银行","inflection":null,"partOfSpeech":"n."}]',
])('invalid or extra contextual meaning output is rejected: %s', async output => {
  const ai = new AI(); vi.spyOn(ai, 'generate').mockResolvedValue(output)
  await expect(ai.explain(emptyState().ai, explanationSelection, 'zh-en')).rejects.toThrow('AI 释义格式无效，请重试')
})
test('phrase and sentence outputs stay concise and preserve discontinuous selection input', async () => {
  const ai = new AI()
  const generate = vi.spyOn(ai, 'generate').mockResolvedValueOnce('{"translation":"想要做某事","inflection":null,"partOfSpeech":"phr."}').mockResolvedValueOnce('{"translation":"银行开门了。","inflection":null,"partOfSpeech":"sent."}')
  const selection = { ...explanationSelection, text: 'want … to', combined: true, spans: [{ start: 2, end: 6 }, { start: 10, end: 12 }] }
  expect(await ai.explain(emptyState().ai, selection, 'zh-en')).toBe('phr. 想要做某事')
  expect(JSON.parse(generate.mock.calls[0][2])).toMatchObject({ discontinuous: true, fragments: [{ start: 2, end: 6, text: 'want' }, { start: 10, end: 12, text: 'to' }] })
  expect(await ai.explain(emptyState().ai, { ...explanationSelection, text: 'A bank is open.' }, 'zh-en')).toBe('sent. 银行开门了。')
})

test('English-native output rejects Chinese part of speech and translations without English', async () => {
  const ai = new AI()
  const generate = vi.spyOn(ai, 'generate').mockResolvedValueOnce('{"translation":"银行","inflection":null,"partOfSpeech":"n."}').mockResolvedValueOnce('{"translation":"bank","inflection":null,"partOfSpeech":"名词"}')
  await expect(ai.explain(emptyState().ai, explanationSelection, 'en-zh')).rejects.toThrow('AI 释义格式无效')
  await expect(ai.explain(emptyState().ai, explanationSelection, 'en-zh')).rejects.toThrow('AI 释义格式无效')
  expect(generate).toHaveBeenCalledTimes(2)
})

test.each(['zh-en', 'en-zh'] as const)('part-of-speech abbreviations work and full labels are rejected for %s', async profile => {
  const ai = new AI()
  const generate = vi.spyOn(ai, 'generate')
  const translation = profile === 'zh-en' ? '翻译' : 'translation'
  for (const abbreviation of ['n.', 'v.', 'adj.', 'adv.', 'phr.', 'sent.']) {
    generate.mockResolvedValueOnce(JSON.stringify({ translation, partOfSpeech: abbreviation, inflection: null }))
    expect(await ai.explain(emptyState().ai, explanationSelection, profile)).toBe(`${abbreviation} ${translation}`)
  }
  for (const fullLabel of ['名词', '动词', '形容词', 'noun', 'verb', 'adjective']) {
    generate.mockResolvedValueOnce(JSON.stringify({ translation, partOfSpeech: fullLabel, inflection: null }))
    await expect(ai.explain(emptyState().ai, explanationSelection, profile)).rejects.toThrow('AI 释义格式无效')
  }
  expect(generate.mock.calls[0][1]).toContain('Always write partOfSpeech as an English abbreviation')
})

test.each([
  ['drove', 'drive', '过去式', 'v.', '驾驶'],
  ['children', 'child', '复数', 'n.', '孩子们'],
  ['better', 'good', '比较级', 'adj.', '更好的'],
  ['running', 'run', '现在分词', 'v.', '跑步'],
])('inflected word %s includes its base form and contextual change', async (text, baseForm, change, partOfSpeech, translation) => {
  const ai = new AI()
  const generate = vi.spyOn(ai, 'generate').mockResolvedValue(JSON.stringify({ translation, partOfSpeech, inflection: { baseForm, change } }))
  expect(await ai.explain(emptyState().ai, { ...explanationSelection, text }, 'zh-en')).toBe(`${partOfSpeech} ${translation}\n${baseForm} → ${text}（${change}）`)
  expect(generate.mock.calls[0][1]).toContain('actual sentence context')
})
test.each([
  { baseForm: 'bank', change: '复数' },
  { baseForm: 'BANK', change: '复数' },
  { baseForm: '', change: '过去式' },
  { baseForm: 'river bank', change: '复数' },
  { baseForm: 'drive', change: 'example explanation' },
  { baseForm: 'drive', change: '过去式', example: 'I drove.' },
  { baseForm: 'drive' },
])('malformed or unchanged base forms are rejected: %j', async inflection => {
  const ai = new AI(); vi.spyOn(ai, 'generate').mockResolvedValue(JSON.stringify({ translation: '银行', partOfSpeech: 'n.', inflection }))
  await expect(ai.explain(emptyState().ai, explanationSelection, 'zh-en')).rejects.toThrow('AI 释义格式无效')
})
test('phrases, combined selections, sentences and Chinese learning cannot attach single-word inflections', async () => {
  const ai = new AI()
  vi.spyOn(ai, 'generate').mockResolvedValue(JSON.stringify({ translation: '翻译 translation', partOfSpeech: 'v.', inflection: { baseForm: 'drive', change: '过去式' } }))
  for (const selection of [
    { ...explanationSelection, text: 'drove away' },
    { ...explanationSelection, text: 'drove', combined: true },
    { ...explanationSelection, text: 'I drove.' },
  ]) await expect(ai.explain(emptyState().ai, selection, 'zh-en')).rejects.toThrow('AI 释义格式无效')
  await expect(ai.explain(emptyState().ai, { ...explanationSelection, text: 'drove' }, 'en-zh')).rejects.toThrow('AI 释义格式无效')
})
