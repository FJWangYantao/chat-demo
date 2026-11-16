import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import {
  getActiveModelConfiguration,
  isChatConfigured,
  NATIVE_PROVIDER,
  useProviders,
} from '../../services/providers.js'
import { createSearchConfig } from '../../services/search/providers.js'

/** 设置弹窗的分组：通用设置 / 数据管理 / 连接应用 / 模型与服务商 / 搜索服务 */
export type SettingsSection = 'general' | 'data' | 'apps' | 'providers' | 'search'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开设置并选中 API Key 所在的「数据管理」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  openSettings('data')
  return false
}

export const ensureChatProvider = () => {
  if (isChatConfigured()) {
    return true
  }
  openSettings('providers')
  return false
}

export const ensureSearchProvider = () => {
  if (!useSettings.getState().search) {
    return true
  }
  const configuration = getActiveModelConfiguration()
  const staticNative =
    configuration.provider === NATIVE_PROVIDER &&
    (window.location.protocol === 'file:' || useProviders.getState().available !== true)
  if (
    staticNative ||
    createSearchConfig(configuration.toolCalling === false ? 'retrieve' : 'agent')
  ) {
    return true
  }
  openSettings('search')
  return false
}
