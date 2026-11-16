import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  githubConnectionStatus,
  restoreGitHubSession,
  useGitHub,
} from '../../services/apps/githubConnection.js'
import { magpieConnectionStatus, useMagpie } from '../../services/apps/magpieConnection.js'
import {
  restoreWeChatSession,
  useWeChat,
  wechatConnectionStatus,
} from '../../services/apps/wechatConnection.js'
import { MAGPIE_PROVIDER, useProviders } from '../../services/providers.js'
import { IconChevronRightOutline14, IconGitHub16, IconMagpie, IconWeChat } from '../base/icons.js'
import { GitHubConnection } from './GitHubConnection.js'
import { MagpieConnection } from './MagpieConnection.js'
import { WeChatConnection } from './WeChatConnection.js'
import styles from './AppConnections.module.css'

type StatusProps = { id: string }

const GitHubStatus = ({ id }: StatusProps) => {
  const t = useTranslate()
  const status = useGitHub(githubConnectionStatus)
  return (
    <span className={styles.status} id={id} data-status={status}>
      {t(status)}
    </span>
  )
}

const MagpieStatus = ({ id }: StatusProps) => {
  const t = useTranslate()
  const active = useProviders((state) => state.active === MAGPIE_PROVIDER)
  const status = useMagpie((state) => magpieConnectionStatus(state, active))
  return (
    <span className={styles.status} id={id} data-status={status}>
      {t(status)}
    </span>
  )
}

const WeChatStatus = ({ id }: StatusProps) => {
  const t = useTranslate()
  const status = useWeChat(wechatConnectionStatus)
  return (
    <span className={styles.status} id={id} data-status={status}>
      {t(status)}
    </span>
  )
}

const apps = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'githubSummary',
    Logo: IconGitHub16,
    Status: GitHubStatus,
    Settings: GitHubConnection,
  },
  {
    id: 'wechat',
    name: '微信',
    description: 'wechatSummary',
    Logo: IconWeChat,
    Status: WeChatStatus,
    Settings: WeChatConnection,
  },
  {
    id: 'magpie',
    name: 'Magpie',
    description: 'magpieSummary',
    Logo: IconMagpie,
    Status: MagpieStatus,
    Settings: MagpieConnection,
  },
] as const

type AppId = (typeof apps)[number]['id']

export const AppConnections = () => {
  const t = useTranslate()
  const oauthError = useGitHub((state) => state.oauthError)
  const wechatError = useWeChat((state) => state.error)
  const [selected, setSelected] = useState<AppId | null>(null)
  const previousSelection = useRef<AppId | null>(null)
  const buttons = useRef(new Map<AppId, HTMLButtonElement>())
  const backButton = useRef<HTMLButtonElement>(null)
  const id = useId()
  const app = apps.find((item) => item.id === selected)

  useEffect(() => {
    const refresh = () => {
      void restoreGitHubSession()
      void restoreWeChatSession()
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    if (selected) {
      backButton.current?.focus()
    } else if (previousSelection.current) {
      buttons.current.get(previousSelection.current)?.focus()
    }
    previousSelection.current = selected
  }, [selected])

  return (
    <div className={styles.apps}>
      {app ? (
        <>
          <button
            ref={backButton}
            type="button"
            className={styles.back}
            onClick={() => setSelected(null)}
          >
            <span aria-hidden="true">
              <IconChevronRightOutline14 />
            </span>
            {t('settingsApps')}
          </button>
          <app.Settings />
        </>
      ) : (
        <>
          <h2 className={styles.heading}>{t('settingsApps')}</h2>
          <ul className={styles.grid} role="list">
            {apps.map((item) => (
              <li key={item.id}>
                <button
                  ref={(button) => {
                    if (button) {
                      buttons.current.set(item.id, button)
                    } else {
                      buttons.current.delete(item.id)
                    }
                  }}
                  type="button"
                  className={styles.app}
                  aria-labelledby={`${id}-${item.id}-name`}
                  aria-describedby={`${id}-${item.id}-description ${id}-${item.id}-status`}
                  onClick={() => setSelected(item.id)}
                >
                  <span className={styles.logo} aria-hidden="true">
                    <item.Logo />
                  </span>
                  <span className={styles.text}>
                    <span className={styles.name}>
                      <span id={`${id}-${item.id}-name`}>{item.name}</span>
                      <item.Status id={`${id}-${item.id}-status`} />
                    </span>
                    <span className={styles.description} id={`${id}-${item.id}-description`}>
                      {t(item.description)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p role="status" className={styles.error}>
            {oauthError || wechatError}
          </p>
        </>
      )}
    </div>
  )
}
