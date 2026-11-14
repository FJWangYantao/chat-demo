import { IconLinkOutline16, IconThinkOutline16 } from '../base/icons.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './Sider.module.css'

export const SiderConfiguration = () => (
  <div className={styles.configuration}>
    <button
      type="button"
      className={styles.configurationButton}
      aria-haspopup="dialog"
      onClick={() => {
        closeMobileSider()
        openSettings('providers')
      }}
    >
      <span className={styles.configurationIcon} aria-hidden="true">
        <IconThinkOutline16 />
      </span>
      Provider
    </button>
    <button
      type="button"
      className={styles.configurationButton}
      aria-haspopup="dialog"
      onClick={() => {
        closeMobileSider()
        openSettings('apps')
      }}
    >
      <span className={styles.configurationIcon} aria-hidden="true">
        <IconLinkOutline16 />
      </span>
      Connector
    </button>
  </div>
)
