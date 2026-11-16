import { useEffect, useRef } from 'react'
import modelUrl from '../../assets/vrm/BlueFatFish.optimized.glb'
import idleMotion from '../../assets/vrm/idle.vrma'
import { createVrmRenderer, type VrmRenderer } from './vrmRenderer.js'

export function VrmRuntime({
  paused,
  className,
  onReady,
  onError,
}: {
  paused: boolean
  className?: string
  onReady: () => void
  onError: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<VrmRenderer | null>(null)
  const pausedRef = useRef(paused)
  const callbacksRef = useRef({ onReady, onError })
  pausedRef.current = paused
  callbacksRef.current = { onReady, onError }

  useEffect(() => {
    let active = true
    let inViewport = true
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const syncPlayback = () => {
      const renderer = rendererRef.current
      if (!renderer) {
        return
      }
      if (pausedRef.current || document.hidden || !inViewport) {
        renderer.pause()
      } else {
        renderer.play()
      }
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry?.isIntersecting ?? true
        syncPlayback()
      },
      { rootMargin: '100px' }
    )
    observer.observe(canvas)
    document.addEventListener('visibilitychange', syncPlayback)
    createVrmRenderer({
      canvas,
      modelUrl,
      motionUrl: idleMotion,
      onContextLost: () => {
        if (active) {
          callbacksRef.current.onError()
        }
      },
    })
      .then((renderer) => {
        if (!active) {
          renderer.dispose()
          return
        }
        rendererRef.current = renderer
        if (pausedRef.current) {
          renderer.renderOnce()
        } else {
          renderer.play()
        }
        syncPlayback()
        callbacksRef.current.onReady()
      })
      .catch(() => {
        if (active) {
          callbacksRef.current.onError()
        }
      })
    return () => {
      active = false
      observer.disconnect()
      document.removeEventListener('visibilitychange', syncPlayback)
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    if (paused) {
      rendererRef.current?.pause()
    } else {
      rendererRef.current?.play()
    }
  }, [paused])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
