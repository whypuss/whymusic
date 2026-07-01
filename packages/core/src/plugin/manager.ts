import { Plugin, MusicItem, SearchResults } from '../types'
import { PluginRunner } from './runner'

/**
 * 插件管理器
 * 負責加載、管理、搜索插件
 */
export class PluginManager {
  private plugins: Plugin[] = []

  /**
   * 加載插件代碼
   */
  loadPlugin(code: string, name: string): void {
    const plugin = PluginRunner.load(code)
    const enhancedPlugin: Plugin = {
      ...plugin,
      name: plugin.name || name,
      platform: plugin.platform || name,
    }
    this.plugins.push(enhancedPlugin)
  }

  /**
   * 從 URL 加載插件
   */
  async loadFromURL(url: string, name: string): Promise<void> {
    const plugin = await PluginRunner.loadFromURL(url)
    const enhancedPlugin: Plugin = {
      ...plugin,
      name: plugin.name || name,
      platform: plugin.platform || name,
    }
    this.plugins.push(enhancedPlugin)
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
  }

  /**
   * 調用所有插件的搜索
   */
  async search(keyword: string): Promise<MusicItem[]> {
    const results: MusicItem[][] = await Promise.all(
      this.plugins.map(async (p) => {
        try {
          const result = await p.search(keyword)
          // 插件可能返回 SearchResults 或直接的 MusicItem[]
          if (Array.isArray(result)) {
            return result as MusicItem[]
          }
          if (result && typeof result === 'object' && 'data' in result && Array.isArray((result as SearchResults).data)) {
            return (result as SearchResults).data as MusicItem[]
          }
          return [] as MusicItem[]
        } catch (err) {
          console.error(`插件 ${p.name} 搜索失敗:`, err)
          return [] as MusicItem[]
        }
      })
    )
    return results.flat()
  }
}
