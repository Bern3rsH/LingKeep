import { AppSelect } from './AppSelect'
import { useI18n } from './i18n'
import { useState } from 'react'
import { nativeLanguage as nativeLanguageForProfile, profileIds, targetLanguage, type ProfileId } from '../../shared/domain'

const languages = [{ code: 'zh', label: '中文' }, { code: 'en', label: 'English' }] as const
const learningLanguages = [...languages, { code: 'fr', label: '法语' }] as const

export function LanguageSettings({ profileId, busy, switchProfile, previewInterfaceLanguage = true }: { previewInterfaceLanguage?: boolean; profileId?: ProfileId; busy: boolean; switchProfile(profile: ProfileId): void }) {
  const { t, setLanguage } = useI18n()
  const [nativeLanguage, setNativeLanguage] = useState<string>(profileId ? nativeLanguageForProfile(profileId) : '')
  const [learningLanguage, setLearningLanguage] = useState<string>(profileId ? targetLanguage(profileId) : '')
  const selectedProfile = profileIds.find(profile => profile === `${nativeLanguage}-${learningLanguage}`)
  const canSave = Boolean(selectedProfile && selectedProfile !== profileId && !busy)

  return <form className={profileId ? 'settings-form' : undefined} onSubmit={event => { event.preventDefault(); if (canSave && selectedProfile) switchProfile(selectedProfile) }} aria-busy={busy}>
    <label className={profileId ? 'settings-field' : undefined}><span>{t("母语")}</span><AppSelect name="native-language" aria-label={t("母语")} value={nativeLanguage} disabled={busy} onValueChange={value => { setNativeLanguage(value); if (!profileId && previewInterfaceLanguage) setLanguage(value === 'en' ? 'en' : 'zh') }}>
      <option value="">{t("请选择母语")}</option>
      {languages.filter(language => language.code !== learningLanguage).map(language => <option key={language.code} value={language.code}>{t(language.label)}</option>)}
    </AppSelect></label>
    <label className={profileId ? 'settings-field' : undefined}><span>{t("学习语言")}</span><AppSelect name="learning-language" aria-label={t("学习语言")} value={learningLanguage} disabled={busy} onValueChange={setLearningLanguage}>
      <option value="">{t("请选择学习语言")}</option>
      {learningLanguages.filter(language => language.code !== nativeLanguage).map(language => <option key={language.code} value={language.code}>{t(language.label)}</option>)}
    </AppSelect></label>
    <div className="row language-actions">
      {profileId && <button type="button" disabled={busy} onClick={() => { setNativeLanguage(''); setLearningLanguage('') }}>{t("重新选择")}</button>}
      <button className={profileId ? 'primary settings-save' : 'primary'} type="submit" disabled={!canSave}>{busy ? profileId ? t("切换中…") : t("正在进入…") : profileId ? t("保存学习语言") : t("进入 Library →")}</button>
    </div>
    {profileId && <p className="muted settings-hint">{t("保存后切换至对应的学习空间，学习内容和进度按语言组合独立保存。")}</p>}
  </form>
}
