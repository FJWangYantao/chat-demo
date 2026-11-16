import { vrmStates, type VrmState } from './vrmAssets.js'

export const VrmStateIcon = ({ state, className }: { state: VrmState; className?: string }) => {
  const asset = vrmStates[state]
  return (
    <img
      className={className}
      src={asset.src}
      srcSet={asset.srcSet}
      width={256}
      height={256}
      alt=""
      fetchPriority="low"
    />
  )
}
