import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  Clock,
  DirectionalLight,
  HemisphereLight,
  LoopOnce,
  LoopRepeat,
  Mesh,
  type Object3D,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin } from '@pixiv/three-vrm'
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'

const disposeScene = (root: Object3D) => {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) {
          value.dispose()
        }
      }
      material.dispose()
    }
  })
}

export type VrmRenderer = {
  duration: number | null
  play: () => void
  pause: () => void
  renderAt: (seconds: number) => void
  renderOnce: () => void
  dispose: () => void
}

export const createVrmRenderer = async ({
  canvas,
  modelUrl,
  motionUrl,
  interactive = true,
  loop = true,
  rotationY = 0,
  fitAfterPose = false,
  preserveDrawingBuffer = false,
  onContextLost,
}: {
  canvas: HTMLCanvasElement
  modelUrl: string
  motionUrl?: string
  interactive?: boolean
  loop?: boolean
  rotationY?: number
  fitAfterPose?: boolean
  preserveDrawingBuffer?: boolean
  onContextLost?: () => void
}): Promise<VrmRenderer> => {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1

  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.enableZoom = false
  controls.enabled = interactive
  controls.minPolarAngle = Math.PI / 3
  controls.maxPolarAngle = Math.PI * 0.65

  scene.add(new HemisphereLight(0xffffff, 0x30343c, 1.6))
  scene.add(new AmbientLight(0xffffff, 0.45))
  const keyLight = new DirectionalLight(0xffffff, 2)
  keyLight.position.set(2, 4, 3)
  scene.add(keyLight)

  let vrm: Awaited<ReturnType<GLTFLoader['loadAsync']>>['userData']['vrm']
  let mixer: AnimationMixer | undefined
  let disposed = false
  let playing = false
  let modelHeight = 1
  let duration: number | null = null
  const clock = new Clock()

  const renderOnce = () => {
    if (!disposed) {
      renderer.render(scene, camera)
    }
  }
  const resize = () => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) {
      return
    }
    const aspect = width / height
    const viewHeight = modelHeight * 1.25
    camera.left = (-viewHeight * aspect) / 2
    camera.right = (viewHeight * aspect) / 2
    camera.top = viewHeight / 2
    camera.bottom = -viewHeight / 2
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    renderOnce()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas.parentElement ?? canvas)
  controls.addEventListener('change', renderOnce)

  const fitToPose = () => {
    if (!vrm) {
      return
    }
    const bounds = new Box3().setFromObject(vrm.scene)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    modelHeight = Math.max(size.x, size.y, size.z, 0.001)
    controls.target.copy(center)
    camera.position.set(
      center.x + modelHeight * 0.55,
      center.y + modelHeight * 0.13,
      center.z + modelHeight * 2.2
    )
    camera.lookAt(controls.target)
    controls.update()
    resize()
  }

  const animate = (time: number) => {
    if (time - lastFrame < 1000 / 30) {
      return
    }
    lastFrame = time
    const delta = clock.getDelta()
    mixer?.update(delta)
    vrm.update(delta)
    controls.update()
    renderOnce()
  }
  let lastFrame = 0
  const pause = () => {
    if (!playing) {
      return
    }
    playing = false
    renderer.setAnimationLoop(null)
  }
  const contextLost = (event: Event) => {
    event.preventDefault()
    pause()
    onContextLost?.()
  }
  const contextRestored = () => renderOnce()
  canvas.addEventListener('webglcontextlost', contextLost)
  canvas.addEventListener('webglcontextrestored', contextRestored)

  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    pause()
    resizeObserver.disconnect()
    controls.removeEventListener('change', renderOnce)
    controls.dispose()
    canvas.removeEventListener('webglcontextlost', contextLost)
    canvas.removeEventListener('webglcontextrestored', contextRestored)
    if (vrm) {
      disposeScene(vrm.scene)
    }
    renderer.dispose()
  }

  try {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await loader.loadAsync(modelUrl)
    vrm = gltf.userData.vrm
    vrm.scene.rotation.y = rotationY
    scene.add(vrm.scene)

    const bounds = new Box3().setFromObject(vrm.scene)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    modelHeight = Math.max(size.y, 0.001)
    vrm.scene.position.x -= center.x
    vrm.scene.position.y -= bounds.min.y
    vrm.scene.position.z -= center.z
    camera.position.set(modelHeight * 0.55, modelHeight * 0.58, modelHeight * 2.2)
    controls.target.set(0, modelHeight * 0.45, 0)
    camera.lookAt(controls.target)
    controls.update()

    if (motionUrl) {
      const motionLoader = new GLTFLoader()
      motionLoader.register((parser) => new VRMAnimationLoaderPlugin(parser))
      const animation = await motionLoader.loadAsync(motionUrl)
      const clip = createVRMAnimationClip(animation.userData.vrmAnimations[0], vrm)
      duration = clip.duration
      mixer = new AnimationMixer(vrm.scene)
      const action = mixer.clipAction(clip)
      action.setLoop(loop ? LoopRepeat : LoopOnce, 1)
      action.clampWhenFinished = !loop
      action.play()
    }
    resize()
    renderOnce()
  } catch (error) {
    dispose()
    throw error
  }

  return {
    duration,
    play: () => {
      if (disposed || playing) {
        return
      }
      playing = true
      clock.getDelta()
      lastFrame = 0
      renderer.setAnimationLoop(animate)
    },
    pause,
    renderAt: (seconds) => {
      mixer?.setTime(seconds)
      vrm.update(0)
      if (fitAfterPose) {
        fitToPose()
      } else {
        controls.update()
        renderOnce()
      }
    },
    renderOnce,
    dispose,
  }
}
