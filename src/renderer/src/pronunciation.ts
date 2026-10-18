import { targetLanguage, type ProfileId, type Selection } from '../../shared/domain'
import { pronunciationLocales, pronunciationText } from '../../shared/pronunciation'
import { invoke } from './api'

const MIN_PLAYBACK_TIMEOUT_MS = 15_000
const PLAYBACK_MS_PER_CHARACTER = 250

export class PronunciationPlayer {
  private generation = 0
  private cleanup: (() => void) | undefined
  private utterance: SpeechSynthesisUtterance | undefined

  stop(): void {
    this.generation++
    this.cleanup?.()
    this.cleanup = undefined
  }
  async play(selection: Selection, profile: ProfileId): Promise<void> {
    this.stop()
    const generation = this.generation
    const text = pronunciationText(selection)
    const current = () => this.generation === generation
    const timeout = Math.max(MIN_PLAYBACK_TIMEOUT_MS, text.length * PLAYBACK_MS_PER_CHARACTER)
    try {
      const result = await invoke({ type: 'pronounce', profile, selection })
      if (!current()) return
      if (!result.audio?.data) throw new Error('发音音频无效')
      const bytes = Uint8Array.from(atob(result.audio.data), character => character.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: result.audio.mimeType }))
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(url)
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (error?: Error) => {
          if (settled) return
          settled = true; clearTimeout(timer)
          audio.onended = null; audio.onerror = null; audio.pause(); URL.revokeObjectURL(url)
          if (this.cleanup === cancel) this.cleanup = undefined
          error ? reject(error) : resolve()
        }
        const cancel = () => finish()
        this.cleanup = cancel
        audio.onended = () => finish()
        audio.onerror = () => finish(new Error('发音播放失败'))
        timer = setTimeout(() => finish(new Error('发音播放超时')), timeout)
        try { void audio.play().catch(() => finish(new Error('发音播放失败'))) }
        catch { finish(new Error('发音播放失败')) }
      })
    } catch {
      if (!current()) return
      const speech = window.speechSynthesis
      if (!speech || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('发音暂不可用，请重试')
      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text)
        this.utterance = utterance
        utterance.lang = pronunciationLocales[targetLanguage(profile)]
        utterance.rate = 0.9
        const voices = speech.getVoices()
        const voice = voices.find(voice => voice.lang.replace('_', '-').toLowerCase() === utterance.lang.toLowerCase()) || voices.find(voice => voice.lang.split(/[-_]/)[0].toLowerCase() === targetLanguage(profile))
        if (voice) utterance.voice = voice
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (error?: Error) => {
          if (settled) return
          settled = true; clearTimeout(timer)
          utterance.onend = null; utterance.onerror = null
          if (this.cleanup === cancel) { this.cleanup = undefined; speech.cancel() }
          if (this.utterance === utterance) this.utterance = undefined
          error ? reject(error) : resolve()
        }
        const cancel = () => finish()
        this.cleanup = cancel
        utterance.onend = () => finish()
        utterance.onerror = () => finish(new Error('发音暂不可用，请重试'))
        timer = setTimeout(() => finish(new Error('发音播放超时')), timeout)
        try { speech.speak(utterance) } catch { finish(new Error('发音暂不可用，请重试')) }
      })
    }
  }
}

export const pronunciation = new PronunciationPlayer()
