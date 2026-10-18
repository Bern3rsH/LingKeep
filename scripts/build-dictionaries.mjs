import { mkdir, writeFile, rename } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { englishMeanings } from '../src/shared/dictionary-format.ts'

const destination = new URL('../resources/dictionaries/', import.meta.url)
await mkdir(destination, { recursive: true })
const sources = {
  ecdict: 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv',
  cedict: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz'
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`Dictionary download failed: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
const english = Object.create(null), chinese = Object.create(null), lemmas = Object.create(null)
const englishBytes = await fetchBytes(sources.ecdict)
for (const row of parse(englishBytes, { columns: true, skip_empty_lines: true, bom: true })) {
  const word = row.word.trim().toLowerCase()
  if (!word) continue
  const meanings = englishMeanings(row.translation)
  if (meanings.length) english[word] = [...new Set([...(english[word] || []), ...meanings])]
  for (const exchange of row.exchange.split('/')) {
    const [kind, forms] = exchange.split(':')
    if (!forms) continue
    if (kind === '0') lemmas[word] = forms.split(',')[0].toLowerCase()
    else if (['p', 'd', 'i', '3', 's', 'r', 't'].includes(kind)) for (const form of forms.split(',')) lemmas[form.toLowerCase()] ??= word
  }
}
const chineseBytes = await fetchBytes(sources.cedict)
const chineseText = gunzipSync(chineseBytes).toString('utf8')
for (const line of chineseText.split('\n')) {
  if (line.startsWith('#')) continue
  const match = line.trimEnd().match(/^(\S+) (\S+) \[([^\]]+)\] \/(.*)\/$/)
  if (!match) continue
  const [, traditional, simplified, pinyin, definition] = match
  const meanings = definition.split('/').filter(Boolean).map(text => `${text} [${pinyin}]`)
  for (const word of new Set([traditional, simplified])) chinese[word] = [...new Set([...(chinese[word] || []), ...meanings])]
}
if (Object.keys(english).length < 100_000 || Object.keys(chinese).length < 50_000) throw new Error(`Dictionary entry count is unexpectedly small: ECDICT=${Object.keys(english).length}, CC-CEDICT=${Object.keys(chinese).length}`)
const manifests = {}
for (const [name, dictionary] of Object.entries({ ecdict: { entries: english, lemmas }, cedict: { entries: chinese, lemmas: {} } })) {
  const bytes = gzipSync(JSON.stringify(dictionary))
  await writeFile(new URL(`${name}.json.gz.tmp`, destination), bytes)
  await rename(new URL(`${name}.json.gz.tmp`, destination), new URL(`${name}.json.gz`, destination))
  manifests[name] = { source: sources[name], sourceSha256: digest(name === 'ecdict' ? englishBytes : chineseBytes), sha256: digest(bytes), entries: Object.keys(dictionary.entries).length }
}
await writeFile(new URL('manifest.json', destination), JSON.stringify({ generatedAt: new Date().toISOString(), dictionaries: manifests }, null, 2))
await writeFile(new URL('ECDICT-LICENSE.txt', destination), await fetchBytes('https://raw.githubusercontent.com/skywind3000/ECDICT/master/LICENSE'))
await writeFile(new URL('CC-CEDICT-NOTICE.txt', destination), chineseText.split('\n').filter(line => line.startsWith('#')).join('\n') + '\n\nCC-CEDICT is licensed under CC BY-SA 4.0.\nhttps://creativecommons.org/licenses/by-sa/4.0/\nSource: https://www.mdbg.net/chinese/dictionary?page=cc-cedict\nChanges: normalized into lookup keys and separate meanings, traditional and simplified indexed.\n')
console.log(JSON.stringify(manifests, null, 2))
