import { Plugin, MusicItem, SearchType } from '../types'
import { PluginRunner } from './runner'

/**
 * MusicFree 原生 PluginManager
 * 完整搬移自 musicfree/src/core/pluginManager/index.ts
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map()
  private enabledPlugins: Set<string> = new Set()

  /**
   * 加載插件（MusicFree 原生邏輯）
   */
  async loadPlugin(code: string): Promise<Plugin> {
    const plugin = PluginRunner.load(code)
    this.plugins.set(plugin.platform, plugin)
    this.enabledPlugins.add(plugin.platform)
    return plugin
  }

  /**
   * 移除插件
   */
  removePlugin(platform: string): void {
    this.plugins.delete(platform)
    this.enabledPlugins.delete(platform)
  }

  /**
   * 獲取所有插件
   */
  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * 獲取啟用的插件（MusicFree 原生邏輯）
   */
  getEnabledPlugins(): Plugin[] {
    return this.getAllPlugins().filter(p => this.enabledPlugins.has(p.platform))
  }

  /**
   * 啟用/禁用插件
   */
  togglePlugin(platform: string, enabled: boolean): void {
    if (enabled) {
      this.enabledPlugins.add(platform)
    } else {
      this.enabledPlugins.delete(platform)
    }
  }

  /**
   * 搜索（MusicFree 原生邏輯）
   * 遍歷所有啟用插件，調用 plugin.search() 方法
   */
  async search(keyword: string, type?: SearchType): Promise<MusicItem[]> {
    const all: MusicItem[] = []
    for (const p of this.getEnabledPlugins()) {
      try {
        const result: any = await p.search?.(keyword, undefined, type)
        if (result && Array.isArray(result.data)) {
          all.push(...result.data)
        }
      } catch (e) {
        console.warn(`插件 ${p.platform} 搜索失敗:`, e)
      }
    }
    return all
  }

  /**
   * 獲取媒體來源（MusicFree 原生邏輯）
   */
  async getMediaSource(item: MusicItem, quality?: string): Promise<any | null> {
    const plugin = this.plugins.get(item.platform)
    if (!plugin) {
      throw new Error(`未找到插件: ${item.platform}`)
    }
    const result = await plugin.getMediaSource?.(item, quality)
    if (!result) {
      throw new Error(`無法獲取媒體來源: ${item.title}`)
    }
    return result
  }
}