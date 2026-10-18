import { InterfaceLanguageSettings } from './InterfaceLanguageSettings'
import { AppSelect } from './AppSelect'
import { useI18n } from './i18n'
import { useState } from 'react'
import { invoke } from './api'
import { LanguageSettings } from './LanguageSettings'
import { providers, providerLabels, type InterfaceLanguage, type Provider, type PublicAI, type ProfileId, type Result } from '../../shared/domain'

const SAVED_KEY_MASK = '••••••••'

export function Settings({ ai, profileId, interfaceLanguage, apply, switchProfile, switchingProfile, back }: { ai: PublicAI; interfaceLanguage?: InterfaceLanguage | null; profileId: ProfileId; apply(result: Result): void; switchProfile(profile: ProfileId): void; switchingProfile: boolean; back(): void }) {
  const { t } = useI18n()
  const [section, setSection] = useState<'models' | 'language' | 'interface'>('models')
  const [provider, setProvider] = useState<Provider>(ai.provider)
  const [key, setKey] = useState(''); const [editingKey, setEditingKey] = useState(false)
  const [model, setModel] = useState(ai.configs[provider]?.model || '')
  const [baseURL, setBaseURL] = useState(ai.ollamaBaseUrl)
  const [models, setModels] = useState<string[]>([]); const [modelsLoaded, setModelsLoaded] = useState(false)
  const [operation, setOperation] = useState<'refresh' | 'save' | 'delete' | null>(null)
  const [feedback, setFeedback] = useState('')
  const saved = ai.configs[provider]
  const busy = operation !== null
  const credentialAvailable = provider === 'ollama' || Boolean(key.trim() || saved?.hasKey)
  const modelUnavailable = credentialAvailable && modelsLoaded && Boolean(model) && !models.includes(model)
  const visibleModels = credentialAvailable ? [...new Set([...(model ? [model] : []), ...models])] : []
  const maskedKey = saved?.source === 'app' && !editingKey && !key

  function selectProvider(next: Provider) {
    setProvider(next); setModel(ai.configs[next]?.model || ''); setKey(''); setEditingKey(false)
    setBaseURL(ai.ollamaBaseUrl); setModels([]); setModelsLoaded(false); setFeedback('')
  }
  async function refresh() {
    setOperation('refresh'); setFeedback('')
    try {
      const response = await invoke({ type: 'models', provider, key, ollamaBaseUrl: baseURL })
      const available = response.models || []
      setModels(available); setModelsLoaded(true)
      if (!available.length) setFeedback('未找到可用的纯文本模型，请检查配置或稍后刷新。')
      else if (model && !available.includes(model)) setFeedback('当前模型不在可用列表中，请重新选择。')
    } catch (error) { setFeedback(error instanceof Error ? error.message : '模型列表加载失败，请重试。') }
    finally { setOperation(null) }
  }
  async function save(removeKey = false) {
    setOperation(removeKey ? 'delete' : 'save'); setFeedback('')
    try {
      apply(await invoke({ type: 'settings', provider, key, model, ollamaBaseUrl: baseURL, removeKey }))
      setKey(''); setEditingKey(false)
      if (removeKey) { setModels([]); setModelsLoaded(false) }
      setFeedback(removeKey ? '已删除应用内密钥；环境变量如已配置仍可使用。' : '设置已保存，可返回原任务继续。')
    } catch (error) { setFeedback(error instanceof Error ? error.message : '设置保存失败，请重试。') }
    finally { setOperation(null) }
  }
  const sections = { models: t("模型"), language: t("学习语言"), interface: t("界面语言") } as const
  return <main className="settings-shell">
    <aside className="settings-sidebar" aria-label={t("设置导航")}>
      <button className="settings-back" onClick={back}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M19 12H5m7-7-7 7 7 7" /></svg> {t("返回")}</button>
      <nav className="settings-categories" aria-label={t("设置分类")}>{(Object.keys(sections) as (keyof typeof sections)[]).map(item => <button key={item} aria-current={section === item ? 'page' : undefined} onClick={() => setSection(item)}>{sections[item]}</button>)}</nav>
    </aside>
    <div className="settings-workspace"><section className="settings">
      {section === 'language' && <h1 className="visually-hidden">{t("学习语言")}</h1>}
      <section hidden={section !== 'language'} className="language-settings"><LanguageSettings profileId={profileId} busy={switchingProfile} switchProfile={switchProfile} /></section>
      <section hidden={section !== 'models'} className="model-settings" aria-label={t("模型设置")}>
        <h1 className="visually-hidden">{t("模型")}</h1>
        <form className="model-settings-form settings-form" onSubmit={event => { event.preventDefault(); if (!busy && !modelUnavailable) void save() }} aria-busy={busy}>
          <label className="settings-field"><span>{t("服务商")}</span><AppSelect aria-label={t("模型服务商")} disabled={busy} value={provider} onValueChange={value => selectProvider(value as Provider)}>{providers.map(item => <option key={item} value={item}>{t(providerLabels[item])}</option>)}</AppSelect></label>
          {provider === 'ollama' ? <label className="settings-field"><span>{t("Ollama 服务地址（无需 API Key）")}</span><input aria-label={t("Ollama 服务地址")} disabled={busy} spellCheck={false} value={baseURL} onChange={event => { setBaseURL(event.target.value); setModel(''); setModels([]); setModelsLoaded(false); setFeedback('') }} /></label> : <div className="settings-field">
            <label htmlFor="provider-api-key">{t('{provider} API 密钥', { provider: t(providerLabels[provider]) })}</label>
            <div className="model-key-row">
              <input id="provider-api-key" aria-label={t('{provider} API 密钥', { provider: t(providerLabels[provider]) })} type="password" autoComplete="off" spellCheck={false} disabled={busy} value={maskedKey ? SAVED_KEY_MASK : key} onFocus={() => setEditingKey(true)} onBlur={() => { if (!key) setEditingKey(false) }} onChange={event => { setEditingKey(true); setKey(event.target.value) }} />
              {saved?.source === 'app' && <button className="model-icon-button model-delete-key" type="button" aria-label={t('删除 {provider} 已保存的密钥', { provider: t(providerLabels[provider]) })} title={t("删除已保存的密钥")} disabled={busy} onClick={() => void save(true)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg></button>}
            </div>
            {saved?.source === 'environment' && <small className="muted">{t("正在使用环境变量密钥")}</small>}
          </div>}
          <div className="settings-field">
            <div className="model-field-heading"><label htmlFor="provider-model">{t("模型")}</label><button className="model-icon-button model-refresh" type="button" aria-label={t("刷新模型列表")} title={t("刷新模型列表")} disabled={busy || !credentialAvailable} onClick={() => void refresh()}><svg className={operation === 'refresh' ? 'is-refreshing' : undefined} aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></svg></button></div>
            <AppSelect id="provider-model" aria-label={t("模型")} value={credentialAvailable ? model : ''} disabled={busy || !credentialAvailable} onValueChange={setModel}><option value="">{t("请选择模型")}</option>{visibleModels.map(item => <option value={item} key={item} disabled={modelUnavailable && item === model}>{item}{modelUnavailable && item === model ? t("（不可用）") : ''}</option>)}</AppSelect>
          </div>
          <button className="primary settings-save" type="submit" disabled={busy || modelUnavailable}>{operation === 'save' ? t("保存中…") : t("保存设置")}</button>
        </form>
        {feedback && <p className="model-feedback" role="status">{t(feedback)}</p>}
      </section>
      {section === 'interface' && <h1 className="visually-hidden">{t('界面语言')}</h1>}
      <section hidden={section !== 'interface'} className="interface-language-settings"><InterfaceLanguageSettings language={interfaceLanguage} apply={apply} /></section>
      <section hidden className="panel"><h2>{t("离线词库")}</h2><p>{t("英文 → 中文：ECDICT 基础版（MIT）")}</p><p>{t("中文 → 英文：CC-CEDICT（CC BY-SA 4.0）")}</p><p className="muted">{t("完整词库保存在本机。AI 只接收选中内容与相关完整句子；中文分词接收待处理正文。")}</p></section>
    </section></div>
  </main>
}
