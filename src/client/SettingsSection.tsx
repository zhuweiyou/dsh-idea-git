/** Plugin settings page: Git diagnostics and behavior notes. */
import React from 'react'
import { useT } from './lib/i18n'
import * as api from './api'

interface VersionInfo {
  found: boolean
  path?: string
  version?: string
}
interface LfsInfo { installed: boolean; version?: string }

export function SettingsSection() {
  const t = useT()
  const [info, setInfo] = React.useState<VersionInfo | null>(null)
  const [lfs, setLfs] = React.useState<LfsInfo | null>(null)
  React.useEffect(() => {
    api.rpc<VersionInfo>('gitVersion', {}).then(setInfo).catch(() => setInfo({ found: false }))
    api.rpc<LfsInfo>('lfsInfo', {}).then(setLfs).catch(() => setLfs({ installed: false }))
  }, [])
  return (
    <div className="dig-settings">
      <h3 className="dig-settings__title">IDEA Git</h3>
      <p className="dig-settings__desc">
        {t('IDEA Git shows the active workspace repository as a bottom panel. Open it from the Git button in the composer.')}
      </p>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t('Git executable')}</span>
        <span className="dig-settings__value">
          {info === null ? t('Loading') : info.found ? `${info.path}  ·  ${info.version}` : t('Not found')}
        </span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t('Git LFS')}</span>
        <span className="dig-settings__value">{lfs === null ? t('Loading') : lfs.installed ? (lfs.version || t('Installed')) : t('Not found')}</span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t('Repository')}</span>
        <span className="dig-settings__value">{t('Follows the active conversation workspace (including subdirectories).')}</span>
      </div>
      <div className="dig-settings__row">
        <span className="dig-settings__label">{t('Theme and language')}</span>
        <span className="dig-settings__value">{t('Follow DSH settings.')}</span>
      </div>
    </div>
  )
}
