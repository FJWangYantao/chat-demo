import antigravityIcon from '../../assets/providers/antigravity.svg'
import autoIcon from '../../assets/providers/auto.svg'
import codexIcon from '../../assets/providers/codex.svg'
import commandcodeIcon from '../../assets/providers/commandcode.svg'
import doubaoIcon from '../../assets/providers/doubao.svg'
import grokIcon from '../../assets/providers/grok.svg'
import qoderIcon from '../../assets/providers/qoder.svg'
import workbuddyIcon from '../../assets/providers/workbuddy.svg'
import zcodeIcon from '../../assets/providers/zcode.png'
import styles from './MagpieConnection.module.css'

const icons: Record<string, string> = {
  antigravity: antigravityIcon,
  auto: autoIcon,
  codex: codexIcon,
  'commandcode-plan': commandcodeIcon,
  doubao: doubaoIcon,
  grok: grokIcon,
  qoder: qoderIcon,
  workbuddy: workbuddyIcon,
  'workbuddy-global': workbuddyIcon,
  'workbuddy-vps': workbuddyIcon,
  zcode: zcodeIcon,
}

export const MagpieProviderIcon = ({ provider }: { provider: string }) => {
  const source = icons[provider]
  if (source) {
    return (
      <img
        className={styles.providerIcon}
        src={source}
        width={20}
        height={20}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    )
  }
  return (
    <svg
      className={styles.providerIcon}
      viewBox="0 0 24 24"
      width={20}
      height={20}
      aria-hidden="true"
      focusable="false"
    >
      <rect x={1} y={1} width={22} height={22} rx={6} fill="currentColor" opacity={0.08} />
      <text x={12} y={16} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor">
        {provider.slice(0, 1).toUpperCase() || '?'}
      </text>
    </svg>
  )
}
