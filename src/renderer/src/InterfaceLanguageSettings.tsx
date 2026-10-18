import { useEffect, useState } from 'react'
import type { InterfaceLanguage, Result } from '../../shared/domain'
import { AppSelect } from './AppSelect'
import { invoke } from './api'
import { useI18n } from './i18n'

export function InterfaceLanguageSettings({ language = null, apply }: { language?: InterfaceLanguage | null; apply(result: Result): void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<InterfaceLanguage | 'native'>(language ?? 'native')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  useEffect(() => { setDraft(language ?? 'native') }, [language])
  const changed = draft !== (language ?? 'native')
  async function save() {
    if (busy || !changed) return
    setBusy(true); setFeedback('')
    try {
      apply(await invoke({ type: 'interfaceLanguage', language: draft === 'native' ? null : draft }))
      setFeedback('设置已保存，可返回原任务继续。')
    } catch (error) { setFeedback(error instanceof Error ? error.message : '设置保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <>
    <form className="settings-form" onSubmit={event => { event.preventDefault(); void save() }} aria-busy={busy}>
      <label className="settings-field"><span>{t('界面语言')}</span><AppSelect name="interface-language" aria-label={t('界面语言')} value={draft} disabled={busy} onValueChange={value => { setDraft(value as InterfaceLanguage | 'native'); setFeedback('') }}>
        <option value="native">{t('跟随母语')}</option><option value="zh">{t('中文')}</option><option value="en">{t('English')}</option>
      </AppSelect></label>
      <button className="primary settings-save" type="submit" disabled={busy || !changed}>{busy ? t('保存中…') : t('保存设置')}</button>
    </form>
    {feedback && <p className="model-feedback" role="status">{t(feedback)}</p>}
  </>
}
