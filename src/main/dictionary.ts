import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import lemmatizer from 'wink-lemmatizer'
import { targetLanguage, type Meaning, type ProfileId } from '../shared/domain'

type Dictionary = { entries: Record<string, string[]>; lemmas: Record<string, string> }
const decompress = promisify(gunzip)
export class Dictionaries {
  private loaded = new Map<string, Promise<Dictionary>>()
  constructor(readonly directory: string) {}
  private load(name: string): Promise<Dictionary> {
    let pending = this.loaded.get(name)
    if (!pending) {
      pending = (async () => {
        const bytes = await readFile(join(this.directory, `${name}.json.gz`))
        const manifest = JSON.parse(await readFile(join(this.directory, 'manifest.json'), 'utf8'))
        if (createHash('sha256').update(bytes).digest('hex') !== manifest.dictionaries[name].sha256) throw new Error('词库校验失败')
        const data = JSON.parse((await decompress(bytes)).toString('utf8')) as Dictionary
        if (!data.entries || !data.lemmas) throw new Error('词库格式错误')
        return data
      })().catch(error => { this.loaded.delete(name); throw error })
      this.loaded.set(name, pending)
    }
    return pending
  }
  async lookup(text: string, profile: ProfileId): Promise<Meaning[]> {
    if (targetLanguage(profile) === 'fr') return []
    try {
      const dictionary = await this.load(profile === 'zh-en' ? 'ecdict' : 'cedict')
      const word = text.trim().toLowerCase()
      let definitions = Object.hasOwn(dictionary.entries, word) ? dictionary.entries[word] : []
      if (!definitions.length && profile === 'zh-en' && /^[a-z'-]+$/.test(word)) {
        const candidates = [dictionary.lemmas[word], lemmatizer.verb(word), lemmatizer.noun(word), lemmatizer.adjective(word)].filter(Boolean)
        for (const candidate of candidates) if (Object.hasOwn(dictionary.entries, candidate)) { definitions = dictionary.entries[candidate]; break }
      }
      return (definitions || []).map(text => ({ text, source: 'dictionary' }))
    } catch { throw new Error('本地词库暂不可用，请重试') }
  }
}
