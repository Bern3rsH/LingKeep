import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { SpeechService, synthesizeSpeech } from '../src/main/speech'

const engine = vi.hoisted(() => ({ setMetadata: vi.fn(), toStream: vi.fn(), close: vi.fn() }))
vi.mock('msedge-tts', () => ({ MsEdgeTTS: class { setMetadata = engine.setMetadata; toStream = engine.toStream; close = engine.close }, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3' } }))
const directories: string[] = []
const bytes = Buffer.from('ID3test audio')
async function fixture() { const path = await mkdtemp(join(tmpdir(), 'ling-speech-test-')); directories.push(path); return path }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); vi.useRealTimers(); vi.restoreAllMocks(); engine.setMetadata.mockReset(); engine.toStream.mockReset(); engine.close.mockReset() })

test('pronunciation caches by exact text and learning language and survives a new service instance', async () => {
  const path = await fixture()
  const generate = vi.fn(async () => bytes)
  const speech = new SpeechService(path, generate)
  const first = await speech.audio(' bank ', 'en')
  expect(first).toEqual({ data: bytes.toString('base64'), mimeType: 'audio/mpeg' })
  expect(await new SpeechService(path, generate).audio('bank', 'en')).toEqual(first)
  expect(generate).toHaveBeenCalledTimes(1)
  await speech.audio('bank', 'zh')
  expect(generate).toHaveBeenCalledTimes(2)
  expect(await readdir(path)).toHaveLength(2)
  expect(await readFile(join(path, (await readdir(path))[0]))).toEqual(bytes)
})
test('concurrent equal requests share synthesis; failures and invalid audio do not poison retries', async () => {
  const path = await fixture()
  let resolve!: (audio: Buffer) => void
  const generate = vi.fn<() => Promise<Buffer>>().mockImplementationOnce(() => new Promise(resolveAudio => { resolve = resolveAudio })).mockResolvedValue(bytes)
  const speech = new SpeechService(path, generate)
  const first = speech.audio('bank', 'en'), second = speech.audio('bank', 'en')
  await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
  resolve(bytes)
  expect(await first).toEqual(await second)
  generate.mockRejectedValueOnce(new Error('offline'))
  await expect(speech.audio('river', 'en')).rejects.toThrow('offline')
  generate.mockResolvedValueOnce(Buffer.alloc(0))
  await expect(speech.audio('river', 'en')).rejects.toThrow('音频无效')
  expect(await speech.audio('river', 'en')).toMatchObject({ mimeType: 'audio/mpeg' })
  await expect(speech.audio(' ', 'en')).rejects.toThrow('内容无效')
  await expect(speech.audio('x'.repeat(5001), 'en')).rejects.toThrow('内容无效')
})
test('empty cache files regenerate; cache write failure still returns usable audio', async () => {
  const path = await fixture()
  const generate = vi.fn(async () => bytes)
  await new SpeechService(path, generate).audio('hello', 'en')
  await writeFile(join(path, (await readdir(path))[0]), '')
  await new SpeechService(path, generate).audio('hello', 'en')
  expect(generate).toHaveBeenCalledTimes(2)
  const file = join(path, 'not-a-directory'); await writeFile(file, 'file')
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await new SpeechService(file, generate).audio('你好', 'zh')).toMatchObject({ mimeType: 'audio/mpeg' })
  expect(warning).toHaveBeenCalled()
})
test.each([['en', 'en-US-JennyNeural', 'en-US'], ['zh', 'zh-CN-XiaoxiaoNeural', 'zh-CN'], ['fr', 'fr-FR-DeniseNeural', 'fr-FR']] as const)('Edge synthesis uses the %s voice, escapes text and closes its connection', async (language, voice, locale) => {
  engine.setMetadata.mockResolvedValue(undefined)
  engine.toStream.mockReturnValue({ audioStream: Readable.from([bytes]) })
  expect(await synthesizeSpeech('A < B & "word"', language)).toEqual(bytes)
  expect(engine.setMetadata).toHaveBeenCalledWith(voice, 'mp3', { voiceLocale: locale })
  expect(engine.toStream).toHaveBeenCalledWith('A &lt; B &amp; &quot;word&quot;')
  expect(engine.close).toHaveBeenCalledTimes(1)
})
test('connection timeout and stream errors close Edge resources', async () => {
  vi.useFakeTimers()
  engine.setMetadata.mockImplementationOnce(() => new Promise(() => {}))
  const timedOut = expect(synthesizeSpeech('hello', 'en')).rejects.toThrow('超时')
  await vi.advanceTimersByTimeAsync(15_000); await timedOut
  expect(engine.close).toHaveBeenCalledTimes(1)
  engine.setMetadata.mockResolvedValue(undefined)
  engine.toStream.mockReturnValue({ audioStream: Readable.from((async function* () { throw new Error('stream failed') })()) })
  await expect(synthesizeSpeech('hello', 'en')).rejects.toThrow('stream failed')
  expect(engine.close).toHaveBeenCalledTimes(2)
})

test('connection rejection preserves its diagnostic and a subsequent request can retry', async () => {
  engine.setMetadata.mockRejectedValueOnce(new Error('Edge TTS WebSocket error: Unexpected server response: 403'))
  await expect(synthesizeSpeech('hello', 'en')).rejects.toThrow('Unexpected server response: 403')
  expect(engine.toStream).not.toHaveBeenCalled()
  expect(engine.close).toHaveBeenCalledTimes(1)
  engine.setMetadata.mockResolvedValue(undefined)
  engine.toStream.mockReturnValue({ audioStream: Readable.from([bytes]) })
  expect(await synthesizeSpeech('hello', 'en')).toEqual(bytes)
  expect(engine.close).toHaveBeenCalledTimes(2)
})
