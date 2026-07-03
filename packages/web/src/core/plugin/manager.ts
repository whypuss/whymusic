import { Plugin, MusicItem, MediaSource, SearchType } from '../types'
import { PluginRunner } from './runner'

/**
 * 插件管理器
 * 負責加載、管理、搜索插件
 */
export class PluginManager {
  private plugins: Plugin[] = []
  private enabled: Set<string> = new Set()

  /**
   * 加載插件代碼
   */
  loadPlugin(code: string, name?: string): void {
    const plugin = PluginRunner.load(code)
    const enhancedPlugin: Plugin = {
      ...plugin,
      name: plugin.name || name || 'Unknown',
      platform: plugin.platform || name || 'unknown',
    }
    this.plugins.push(enhancedPlugin)
    this.enabled.add(plugin.name)
  }

  /**
   * 從 URL 加載插件
   */
  async loadFromURL(url: string, name?: string): Promise<void> {
    const plugin = await PluginRunner.loadFromURL(url)
    const enhancedPlugin: Plugin = {
      ...plugin,
      name: plugin.name || name || 'Unknown',
      platform: plugin.platform || name || 'unknown',
    }
    this.plugins.push(enhancedPlugin)
    this.enabled.add(plugin.name)
  }

  /**
   * 獲取所有插件
   */
  getPlugins(): Plugin[] {
    return this.plugins
  }

  /**
   * 獲取指定插件
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.find(p => p.name === name || p.platform === name)
  }

  /**
   * 移除插件
   */
  removePlugin(name: string): void {
    this.plugins = this.plugins.filter(p => p.name !== name && p.platform !== name)
    this.enabled.delete(name)
  }

  /**
   * 設置插件啟用狀態
   */
  setPluginEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.enabled.add(name)
    } else {
      this.enabled.delete(name)
    }
  }

  /**
   * 檢查插件是否啟用
   */
  isPluginEnabled(name: string): boolean {
    return this.enabled.has(name)
  }

  /**
   * 調用所有插件的搜索
   */
  async search(keyword: string, type?: SearchType): Promise<MusicItem[]> {
    const allResults: MusicItem[] = []
    for (const p of this.plugins) {
      if (!this.enabled.has(p.name)) continue
      try {
        const result: any = await p.search(keyword, undefined, type)
        if (result && Array.isArray(result.data)) {
          allResults.push(...result.data)
        }
      } catch (err) {
        console.error(`插件 ${p.name} 搜索失敗:`, err)
      }
    }
    return allResults
  }
}
