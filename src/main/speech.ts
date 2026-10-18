import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { MAX_PRONUNCIATION_CHARACTERS } from '../shared/pronunciation'

const SYNTHESIS_TIMEOUT_MS = 15_000
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const MAX_PENDING_SYNTHESIS = 4
const voices = { en: { name: 'en-US-JennyNeural', locale: 'en-US' }, zh: { name: 'zh-CN-XiaoxiaoNeural', locale: 'zh-CN' }, fr: { name: 'fr-FR-DeniseNeural', locale: 'fr-FR' } } as const
type Language = keyof typeof voices
const validAudio = (bytes: Buffer) => bytes.length >= 4 && bytes.length <= MAX_AUDIO_BYTES && (bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 255 && (bytes[1] & 224) === 224)
const escapeXML = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)

export async function synthesizeSpeech(text: string, language: Language): Promise<Buffer> {
  const client = new MsEdgeTTS()
  let stream: Readable | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const generate = async () => {
    const voice = voices[language]
    await client.setMetadata(voice.name, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { voiceLocale: voice.locale })
    stream = client.toStream(escapeXML(text)).audioStream
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk); size += bytes.length
      if (size > MAX_AUDIO_BYTES) throw new Error('发音音频超过大小限制')
      chunks.push(bytes)
    }
    return Buffer.concat(chunks)
  }
  try {
    return await Promise.race([generate(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('发音服务超时')), SYNTHESIS_TIMEOUT_MS) })])
  } finally { clearTimeout(timer); stream?.destroy(); client.close() }
}

export class SpeechService {
  private pending = new Map<string, Promise<Buffer>>()
  constructor(readonly cacheDirectory: string, private readonly synthesize = synthesizeSpeech) {}
  async audio(input: string, language: Language): Promise<{ data: string; mimeType: 'audio/mpeg' }> {
    const text = input.trim()
    if (!text || text.length > MAX_PRONUNCIATION_CHARACTERS || !Object.hasOwn(voices, language)) throw new Error('发音内容无效')
    const key = createHash('sha256').update(JSON.stringify([voices[language].name, text])).digest('hex')
    const path = join(this.cacheDirectory, `${key}.mp3`)
    let bytes: Buffer | undefined
    try { const cached = await readFile(path); if (validAudio(cached)) bytes = cached } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[LingKeep] pronunciation cache read failed') }
    if (!bytes) {
      let pending = this.pending.get(key)
      if (!pending) {
        if (this.pending.size >= MAX_PENDING_SYNTHESIS) throw new Error('发音服务繁忙')
        pending = (async () => {
          const generated = await this.synthesize(text, language)
          if (!validAudio(generated)) throw new Error('发音音频无效')
          const temporary = `${path}.${randomUUID()}.tmp`
          try {
            await mkdir(this.cacheDirectory, { recursive: true, mode: 0o700 })
            await writeFile(temporary, generated, { mode: 0o600 }); await rename(temporary, path)
          } catch { console.warn('[LingKeep] pronunciation cache write failed') }
          finally { await unlink(temporary).catch(() => undefined) }
          return generated
        })().finally(() => this.pending.delete(key))
        this.pending.set(key, pending)
      }
      bytes = await pending
    }
    return { data: bytes.toString('base64'), mimeType: 'audio/mpeg' }
  }
}
