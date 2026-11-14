import {
  IconLinkOutline16,
  IconPanelLeftOutline16,
  IconThinkOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { newChat } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './Sider.module.css'

/** 收起后左上角的按钮组 */
export const CollapsedSider = () => {
  const t = useTranslate()
  return (
    <div className={styles.collapsed}>
      <div className={styles.collapsedGroup}>
        <IconButton
          size="m"
          tone="primary"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('expandSiderbarButton')}
          onClick={() => setSiderCollapsed(false)}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<IconThinkOutline16 />}
          tooltip="Provider"
          aria-haspopup="dialog"
          onClick={() => openSettings('providers')}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<IconLinkOutline16 />}
          tooltip="Connector"
          aria-haspopup="dialog"
          onClick={() => openSettings('apps')}
        />
        <IconButton
          size="m"
          tone="primary"
          icon={<NewChatIcon />}
          tooltip={t('newChat')}
          onClick={newChat}
        />
      </div>
    </div>
  )
}
