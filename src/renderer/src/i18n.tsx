import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { nativeLanguage, type InterfaceLanguage, type ProfileId } from '../../shared/domain'
import { chineseMessages, englishMessages } from './translations'

export type { InterfaceLanguage } from '../../shared/domain'
type Values = Record<string, string | number>
export function languageForProfile(profile: ProfileId): InterfaceLanguage { return nativeLanguage(profile) }

const legacyMessagePatterns: [RegExp, string, string[]][] = [
  [/^(.*)；输入已保留，请返回原内容重试保存。$/s, '{message}；输入已保留，请返回原内容重试保存。', ['message']],
  [/^保存失败：(.*)$/s, '保存失败：{reason}', ['reason']],
  [/^无法连接 (.*)，请检查地址、网络或超时后重试$/, '无法连接 {provider}，请检查地址、网络或超时后重试', ['provider']],
  [/^(.*) 请求失败（HTTP (\d+)）(.*)$/, '{provider} 请求失败（HTTP {status}）{hint}', ['provider', 'status', 'hint']],
  [/^下载失败（HTTP (\d+)）$/, '下载失败（HTTP {status}）', ['status']],
  [/^EPUB 缺少章节或资源：(.*)$/s, 'EPUB 缺少章节或资源：{path}', ['path']],
]

// Legacy IPC messages stay intact in state; only their presentation is localized.
export function translate(language: InterfaceLanguage, message: string, values: Values = {}): string {
  const catalog = language === 'en' ? englishMessages : chineseMessages
  const trimmed = message.trim()
  let translated = Object.hasOwn(catalog, trimmed) ? catalog[trimmed] : undefined
  if (translated === undefined && language === 'en') {
    for (const [pattern, key, names] of legacyMessagePatterns) {
      const match = trimmed.match(pattern)
      if (match) return translate(language, key, Object.fromEntries(names.map((name, index) => [name, translate(language, match[index + 1])])))
    }
  }
  translated = translated === undefined ? message : message.replace(trimmed, translated)
  return translated.replace(/\{(\w+)\}/g, (placeholder, key: string) => Object.hasOwn(values, key) ? String(values[key]) : placeholder)
}
const noop = (_language: InterfaceLanguage) => {}
const I18nContext = createContext({ language: 'zh' as InterfaceLanguage, setLanguage: noop, t: (message: string, values?: Values) => translate('zh', message, values), dateLocale: 'zh-CN' })
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<InterfaceLanguage>('zh')
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en' }, [language])
  const value = useMemo(() => ({ language, setLanguage, t: (message: string, values?: Values) => translate(language, message, values), dateLocale: language === 'zh' ? 'zh-CN' : 'en-US' }), [language])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
export const useI18n = () => useContext(I18nContext)
