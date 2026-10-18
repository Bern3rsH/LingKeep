import type { Selection } from './domain'

export const MAX_PRONUNCIATION_CHARACTERS = 5_000
export const pronunciationLocales = { en: 'en-US', zh: 'zh-CN', fr: 'fr-FR' } as const
export function pronunciationText(selection: Selection): string {
  const text = (selection.combined ? selection.text.split(' … ').join(' ') : selection.text).trim()
  if (!text) throw new Error('请选择文字')
  if (text.length > MAX_PRONUNCIATION_CHARACTERS) throw new Error('选中内容过长，暂不支持发音')
  return text
}
