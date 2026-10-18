// ECDICT groups several comma-separated senses under one part-of-speech prefix.
// Keep parenthesized qualifiers intact while making each sense independently selectable.
export function englishMeanings(translation: string): string[] {
  const result: string[] = []
  for (const line of translation.split(/\\n|\n/).map(line => line.trim()).filter(Boolean)) {
    const prefix = line.match(/^((?:(?:[a-z]+\.|\[[^\]]+\])\s*)+)/i)?.[0] || ''
    const body = line.slice(prefix.length)
    let depth = 0; let buffer = ''
    const push = () => { if (buffer.trim()) result.push(`${prefix}${buffer.trim()}`); buffer = '' }
    for (const character of body) {
      if ('(（[【'.includes(character)) depth++
      if (')）]】'.includes(character)) depth = Math.max(0, depth - 1)
      if (depth === 0 && ',，;；'.includes(character)) push()
      else buffer += character
    }
    push()
  }
  return [...new Set(result)]
}
