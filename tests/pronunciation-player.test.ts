// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { PronunciationPlayer } from '../src/renderer/src/pronunciation'
import type { Result, Selection } from '../src/shared/domain'

const selection: Selection = { materialId: 'book', chapterId: 'chapter', blockId: 'block', spans: [{ start: 0, end: 4 }], combined: false, text: 'bank', context: 'A bank by the river.' }
const response: Result = { audio: { data: btoa('ID3audio'), mimeType: 'audio/mpeg' } }
const invoke = vi.fn()
const revoke = vi.fn()
const speak = vi.fn(), cancel = vi.fn()
const audios: FakeAudio[] = []
const players: PronunciationPlayer[] = []
class FakeAudio {
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  pause = vi.fn()
  play = vi.fn(async () => undefined)
  constructor(readonly src: string) { audios.push(this) }
}
class FakeUtterance {
  lang = ''; rate = 1; voice: unknown
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly text: string) {}
}
function player() { const instance = new PronunciationPlayer(); players.push(instance); return instance }
beforeEach(() => {
  window.ling = { invoke, onCloseRequested: () => () => {} }
  invoke.mockResolvedValue(response)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:audio'), revokeObjectURL: revoke })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', { speak, cancel, getVoices: () => [] })
})
afterEach(() => { players.splice(0).forEach(player => player.stop()); audios.length = 0; vi.clearAllMocks(); vi.unstubAllGlobals() })

test('selected text plays the returned audio and releases it on completion', async () => {
  const playing = player().play(selection, 'zh-en')
  await vi.waitFor(() => expect(audios).toHaveLength(1))
  expect(invoke).toHaveBeenCalledWith({ type: 'pronounce', profile: 'zh-en', selection })
  expect(audios[0].play).toHaveBeenCalledTimes(1)
  audios[0].onended!(); await playing
  expect(revoke).toHaveBeenCalledWith('blob:audio')
  expect(speak).not.toHaveBeenCalled()
})
test('late results from an old lookup cannot play after a newer lookup', async () => {
  let resolve!: (value: Result) => void
  invoke.mockImplementationOnce(() => new Promise(resolveRequest => { resolve = resolveRequest }))
  const instance = player()
  const old = instance.play(selection, 'zh-en')
  const latest = instance.play({ ...selection, text: 'river' }, 'zh-en')
  await vi.waitFor(() => expect(audios).toHaveLength(1))
  resolve(response); await old
  expect(audios).toHaveLength(1)
  audios[0].onended!(); await latest
})
test('new lookup and leaving reading stop current playback without starting a fallback', async () => {
  const instance = player()
  const old = instance.play(selection, 'zh-en')
  await vi.waitFor(() => expect(audios).toHaveLength(1))
  const latest = instance.play(selection, 'zh-en')
  await old
  expect(audios[0].pause).toHaveBeenCalled()
  await vi.waitFor(() => expect(audios).toHaveLength(2))
  instance.stop(); await latest
  expect(audios[1].pause).toHaveBeenCalled()
  expect(speak).not.toHaveBeenCalled()
})
test.each([['zh-en', 'en-US', 'bank'], ['en-zh', 'zh-CN', '你好'], ['zh-fr', 'fr-FR', 'bonjour'], ['en-fr', 'fr-FR', 'école']] as const)('offline fallback uses learning language for %s', async (profile, language, text) => {
  invoke.mockResolvedValueOnce({ error: 'offline' })
  const playing = player().play({ ...selection, text }, profile)
  await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
  const utterance = speak.mock.calls[0][0] as FakeUtterance
  expect(utterance.lang).toBe(language)
  expect(utterance.text).toBe(text)
  utterance.onend!(); await playing
})
test('combined words speak only the selected parts and stop cancels system speech', async () => {
  invoke.mockResolvedValueOnce({ error: 'offline' })
  const instance = player()
  const playing = instance.play({ ...selection, combined: true, text: 'want … to' }, 'zh-en')
  await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
  expect((speak.mock.calls[0][0] as FakeUtterance).text).toBe('want to')
  instance.stop(); await playing
  expect(cancel).toHaveBeenCalled()
})
test('a stopped network request cannot start fallback speech when it fails later', async () => {
  let reject!: (error: Error) => void
  invoke.mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest }))
  const instance = player()
  const playing = instance.play(selection, 'zh-en')
  instance.stop(); reject(new Error('offline')); await playing
  expect(speak).not.toHaveBeenCalled()
  expect(audios).toHaveLength(0)
})
test('audio playback failure releases its URL and falls back to system speech', async () => {
  vi.stubGlobal('Audio', class extends FakeAudio { play = vi.fn(async () => { throw new Error('device failed') }) })
  const playing = player().play(selection, 'zh-en')
  await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1))
  expect(revoke).toHaveBeenCalledWith('blob:audio')
  const utterance = speak.mock.calls[0][0] as FakeUtterance
  expect(utterance.text).toBe('bank')
  utterance.onend!(); await playing
})
