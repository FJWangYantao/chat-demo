import welcome from '../../assets/app/vrm-welcome.webp'
import welcome2x from '../../assets/app/vrm-welcome@2x.webp'
import working from '../../assets/app/vrm-working.webp'
import working2x from '../../assets/app/vrm-working@2x.webp'
import waiting from '../../assets/app/vrm-waiting.webp'
import waiting2x from '../../assets/app/vrm-waiting@2x.webp'
import done from '../../assets/app/vrm-done.webp'
import done2x from '../../assets/app/vrm-done@2x.webp'
import error from '../../assets/app/vrm-error.webp'
import error2x from '../../assets/app/vrm-error@2x.webp'

export const vrmStates = {
  welcome: { src: welcome, srcSet: `${welcome2x} 2x` },
  working: { src: working, srcSet: `${working2x} 2x` },
  waiting: { src: waiting, srcSet: `${waiting2x} 2x` },
  done: { src: done, srcSet: `${done2x} 2x` },
  error: { src: error, srcSet: `${error2x} 2x` },
} as const

export type VrmState = keyof typeof vrmStates
