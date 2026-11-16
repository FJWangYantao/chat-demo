import clsx from 'clsx'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { vrmStates } from './vrmAssets.js'
import styles from './VrmIllustration.module.css'

const VrmRuntime = lazy(async () => ({ default: (await import('./VrmRuntime.js')).VrmRuntime }))
const asset = vrmStates.welcome

const supportsWebGL2 = () => {
  const canvas = document.createElement('canvas')
  return Boolean(canvas.getContext('webgl2'))
}

const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export const VrmIllustration = ({ className }: { className?: string }) => {
  const reducedMotion = usePrefersReducedMotion()
  const [initial] = useState(() => ({
    enabled: !reducedMotion && window.location.protocol !== 'file:' && supportsWebGL2(),
  }))
  const [enabled, setEnabled] = useState(initial.enabled)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    initial.enabled ? 'loading' : 'error'
  )

  useEffect(() => {
    if (reducedMotion) {
      setEnabled(false)
      setStatus('error')
    }
  }, [reducedMotion])

  const ready = useCallback(() => setStatus('ready'), [])
  const fail = useCallback(() => {
    setEnabled(false)
    setStatus('error')
  }, [])

  return (
    <div className={clsx(styles.root, className)}>
      <div className={styles.stage}>
        {status !== 'ready' ? (
          <img
            className={styles.image}
            src={asset.src}
            srcSet={asset.srcSet}
            width={480}
            height={480}
            alt=""
            fetchPriority="high"
          />
        ) : null}
        {enabled ? (
          <Suspense fallback={null}>
            <VrmRuntime
              className={styles.canvas}
              paused={status !== 'ready'}
              onReady={ready}
              onError={fail}
            />
          </Suspense>
        ) : null}
      </div>
    </div>
  )
}
