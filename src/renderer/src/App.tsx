import { useI18n, I18nProvider, languageForProfile } from './i18n'
import { useEffect, useState } from 'react'
import { Library } from './Library'
import { Reader } from './Reader'
import { Keeps } from './Keeps'
import { Settings } from './Settings'
import { LanguageSettings } from './LanguageSettings'
import { invoke } from './api'
import type { Material, ProfileId, Result, Selection, Snapshot } from '../../shared/domain'

type View = 'library' | 'keep' | 'settings' | 'reader'
export function App() { return <I18nProvider><Application /></I18nProvider> }
function Application() {
  const { t, setLanguage } = useI18n()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [view, setView] = useState<View>('library')
  const [returnView, setReturnView] = useState<View>('library')
  const [materialId, setMaterialId] = useState(''); const [jump, setJump] = useState<Selection>()
  const [readerSelection, setReaderSelection] = useState<Selection>()
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const apply = (result: Result) => { if (result.snapshot) { setSnapshot(result.snapshot); if (result.snapshot.notice) setError(result.snapshot.notice) } }
  const report = (error: unknown) => setError(error instanceof Error ? error.message : t("操作失败，请重试"))
  useEffect(() => {
    if (snapshot?.interfaceLanguage) setLanguage(snapshot.interfaceLanguage)
    else if (snapshot?.activeProfile) setLanguage(languageForProfile(snapshot.activeProfile))
  }, [snapshot?.interfaceLanguage, snapshot?.activeProfile, setLanguage])
  const load = () => { setError(''); void invoke({ type: 'snapshot' }).then(apply).catch(report) }
  useEffect(load, [])
  useEffect(() => {
    const failed = (event: Event) => setError((event as CustomEvent<string>).detail)
    window.addEventListener('ling:save-error', failed)
    return () => window.removeEventListener('ling:save-error', failed)
  }, [])
  async function switchProfile(profile: ProfileId) {
    setBusy(true); setError('')
    try { apply(await invoke({ type: 'profile', profile })); setView('library'); setMaterialId(''); setJump(undefined) }
    catch (error) { report(error) } finally { setBusy(false) }
  }
  const open = (material: Material, selection?: Selection) => { setMaterialId(material.id); setJump(selection); setReaderSelection(selection); setView('reader') }
  const settings = () => { if (view !== 'settings') setReturnView(view); setView('settings') }
  const material = snapshot?.profile?.materials.find(material => material.id === materialId)
  if (!snapshot) return <div className="startup"><h1>LingKeep</h1><p>{error ? t(error) : t("正在打开本地学习空间…")}</p>{error && <button onClick={load}>{t("重试读取")}</button>}</div>
  if (!snapshot.activeProfile || !snapshot.profile) return <main className="onboarding"><div className="onboarding-card"><div className="brand"><span>K</span> LingKeep</div><p className="eyebrow">{t("KEEP WHAT YOU LEARN")}</p><h1>{t("从你的语言出发。")}<br /><em>{t("读向更大的世界。")}</em></h1><p className="muted">{t("选择母语和学习语言，开始建立自己的阅读与语境收藏。")}</p><LanguageSettings previewInterfaceLanguage={snapshot.interfaceLanguage == null} busy={busy} switchProfile={profile => void switchProfile(profile)} />{error && <p className="error">{t(error)}</p>}<small className="muted">{t("无需注册 · 数据保存在本机 · 随时切换语言")}</small></div></main>
  const profileId = snapshot.activeProfile
  if (view === 'settings') return <div className="settings-root">{error && <div className="global-error" role="alert"><span>{t(error)}</span><button onClick={() => setError('')}>{t("关闭")}</button></div>}
    <Settings key={profileId} interfaceLanguage={snapshot.interfaceLanguage} ai={snapshot.ai} profileId={profileId} apply={apply} switchingProfile={busy} switchProfile={profile => void switchProfile(profile)} back={() => setView(returnView === 'reader' && !material ? 'library' : returnView)} />
  </div>
  return <div className="app-shell"><nav className="navigation"><div className="brand"><span>K</span><strong>LingKeep</strong></div><div className="nav-links"><button className={view === 'library' || view === 'reader' ? 'active' : ''} onClick={() => setView('library')}><NavigationIcon name="library" />{t('Library')}</button><button className={view === 'keep' ? 'active' : ''} onClick={() => setView('keep')}><NavigationIcon name="keep" />{t('Keep')}<small>{snapshot.profile.keeps.filter(keep => keep.active).length}</small></button></div><div className="nav-bottom"><button onClick={settings}><NavigationIcon name="settings" />{t('Setting')}</button></div></nav>
    <main className="workspace">{error && <div className="global-error" role="alert"><span>{t(error)}</span><button onClick={() => setError('')}>{t("关闭")}</button></div>}
      {view === 'library' && <Library key={profileId} profileId={profileId} materials={snapshot.profile.materials} apply={apply} open={open} report={report} />}
      {view === 'reader' && material && <Reader key={`${profileId}:${material.id}`} profileId={profileId} profile={snapshot.profile} material={material} jump={jump} initialSelection={readerSelection} onSelection={setReaderSelection} apply={apply} report={report} back={() => setView('library')} settings={settings} />}
      {view === 'keep' && <Keeps key={profileId} profileId={profileId} profile={snapshot.profile} apply={apply} jump={open} report={report} />}
    </main>
  </div>
}

const NAVIGATION_ICON_SIZE = 20
const navigationIconPaths = {
  library: 'M4 3h16v18H4zM8 7h8M8 11h8M8 15h5',
  keep: 'm12 3 9 9-9 9-9-9z',
  settings: 'M18.47 9.32L20.80 10.13L20.80 13.87L18.47 14.68L19.55 16.90L16.90 19.55L14.68 18.47L13.87 20.80L10.13 20.80L9.32 18.47L7.10 19.55L4.45 16.90L5.53 14.68L3.20 13.87L3.20 10.13L5.53 9.32L4.45 7.10L7.10 4.45L9.32 5.53L10.13 3.20L13.87 3.20L14.68 5.53L16.90 4.45L19.55 7.10L18.47 9.32Z',
} as const
function NavigationIcon({ name }: { name: keyof typeof navigationIconPaths }) {
  return <svg className="navigation-icon" aria-hidden="true" focusable="false" width={NAVIGATION_ICON_SIZE} height={NAVIGATION_ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={navigationIconPaths[name]} />{name === 'settings' && <circle cx="12" cy="12" r="3" />}
  </svg>
}
