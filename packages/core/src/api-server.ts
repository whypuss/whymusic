/**
 * MusicFree Core - 通用 API Server Module
 * 用於 Cloudflare Pages Functions 執行 plugin 操作
 * 純 Node.js 環境，無 CORS 限制
 */

import { PluginManager } from '../src/plugin/manager'
import { PluginRunner } from '../src/plugin/runner'

// 全局 pluginManager 實例（函數式服務每次冷啟動重新建立）
let pluginManager: PluginManager | null = null

// CDN 鏡像列表（插件代碼來源）
const PLUGIN_CDN_MIRRORS = [
  'https://cdn.jsdelivr.net/gh/maotoumao/MusicFreePlugins@master/dist',
  'https://raw.githubusercontent.com/maotoumao/MusicFreePlugins/master/dist',
]

// 插件安裝映射（CDN 路徑到插件名）
const PLUGIN_CDN_MAP: Record<string, string> = {
  'audiomack/index.js': 'Audiomack',
  'netease/index.js': 'NetEase',
  'spotify/index.js': 'Spotify',
}

/**
 * 取得 PluginManager 實例（初始化並加載已安裝插件）
 */
export function getPluginManager(): PluginManager {
  if (!pluginManager) {
    pluginManager = new PluginManager()
  }
  return pluginManager
}

/**
 * 從 CDN 取得插件代碼
 * @param pluginName 插件名稱
 */
export async function fetchPluginCode(pluginName: string): Promise<string> {
  const cdnPath = Object.entries(PLUGIN_CDN_MAP).find(([_, name]) => name === pluginName)
  if (!cdnPath) {
    throw new Error(`Unknown plugin: ${pluginName}`)
  }

  const [relativePath, _] = cdnPath[0]
  const fullPaths = PLUGIN_CDN_MIRRORS.map(mirror => `${mirror}/${relativePath}`)

  for (const url of fullPaths) {
    try {
      const response = await fetch(url)
      if (!response.ok) continue
      return await response.text()
    } catch {
      continue
    }
  }
  throw new Error(`Failed to fetch plugin code from all CDNs`)
}

/**
 * 加載插件到 PluginManager
 * @param code 插件代碼
 * @returns 加載後的 Plugin
 */
export async function loadPlugin(code: string): Promise<PluginManager> {
  const pm = getPluginManager()
  await pm.loadPlugin(code)
  return pm
}

/**
 * 移除插件
 * @param platform 插件 platform 名
 */
export function removePlugin(platform: string): void {
  const pm = getPluginManager()
  pm.removePlugin(platform)
}

/**
 * 取得所有插件
 */
export function listPlugins(): any[] {
  const pm = getPluginManager()
  return pm.getAllPlugins().map(p => ({
    name: p.name,
    platform: p.platform,
    version: p.version,
    description: p.description,
  }))
}

/**
 * 搜索音樂
 * @param keyword 搜索關鍵字
 * @param type 搜索類型
 * @returns 音樂列表
 */
export async function searchMusic(keyword: string, type?: string): Promise<any[]> {
  const pm = getPluginManager()
  return pm.search(keyword, type as any)
}

/**
 * 取得媒體來源
 * @param item 音樂項目
 * @param quality 音質
 * @returns 媒體來源資訊
 */
export async function getMediaSource(item: any, quality?: string): Promise<any | null> {
  const pm = getPluginManager()
  return pm.getMediaSource(item, quality)
}

/**
 * 初始化自動載入 Audiomack 插件
 */
export async function autoInitAudiomack(): Promise<PluginManager> {
  try {
    const code = await fetchPluginCode('Audiomack')
    return await loadPlugin(code)
  } catch {
    return getPluginManager()
  }
}