import { Plugin, MusicItem, SearchType } from '../types'
import { PluginRunner } from './runner'

/**
 * 插件管理器
 * 完全照搬原項目 MusicFree 的實現邏輯
 */
export class PluginManager {
  private plugins: Plugin[] = []
  private enabled: Set<string> = new Set()

  loadPlugin(code: string, name?: string): void {
    const plugin = PluginRunner.load(code)
    this.plugins.push({
      ...plugin,
      name: plugin.name || name || 'Unknown',
      platform: plugin.platform || name || 'unknown',
    })
    this.enabled.add(plugin.name)
  }

  async loadFromURL(url: string, name?: string): Promise<void> {
    const plugin = await PluginRunner.loadFromURL(url)
    this.plugins.push({
      ...plugin,
      name: plugin.name || name || 'Unknown',
      platform: plugin.platform || name || 'unknown',
    })
    this.enabled.add(plugin.name)
  }

  getPlugins(): Plugin[] {
    return this.plugins
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.find(p => p.name === name || p.platform === name)
  }

  removePlugin(name: string): void {
    this.plugins = this.plugins.filter(p => p.name !== name && p.platform !== name)
    this.enabled.delete(name)
  }

  setPluginEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.enabled.add(name)
    } else {
      this.enabled.delete(name)
    }
  }

  isPluginEnabled(name: string): boolean {
    return this.enabled.has(name)
  }

  /**
   * 搜索 - 完全照搬原項目
   * 原項目：search 返回 { isEnd: true, data: [] }
   * 原項目：如果 plugin.instance.search 不存在，返回 { isEnd: true, data: [] }
   * 原項目：如果 result.data 是數組，遍歷並 resetMediaItem
   */
  async search(keyword: string, type?: SearchType): Promise<MusicItem[]> {
    const allResults: MusicItem[] = []
    for (const p of this.plugins) {
      if (!this.enabled.has(p.name)) continue
      try {
        if (!p.search) {
          continue
        }
        // 原項目：const result = (await this.plugin.instance.search(query, page, type)) ?? {}
        const result: any = await p.search(keyword, undefined, type) ?? {}
        if (Array.isArray(result.data)) {
          result.data.forEach((item: any) => {
            // 原項目：resetMediaItem(_, this.plugin.name)
            // 我們簡化版：設置 platform
            if (!item.platform) item.platform = p.name
            if (!item.source) item.source = p.name
          })
          allResults.push(...result.data)
        } else if (Array.isArray(result)) {
          // 舊插件兼容：直接返回數組
          result.forEach((item: any) => {
            if (!item.platform) item.platform = p.name
            if (!item.source) item.source = p.name
          })
          allResults.push(...result)
        }
      } catch (err) {
        console.error(`插件 ${p.name} 搜索失敗:`, err)
      }
    }
    return allResults
  }

  /**
   * 獲取音源 URL - 完全照搬原項目 getMediaSource 邏輯
   * 原項目：{ url, headers, userAgent }
   * 原項目：如果沒有 getMediaSource，直接返回 musicItem.url
   */
  async getMediaSource(plugin: Plugin, item: MusicItem): Promise<{ url: string; headers?: Record<string, string> } | null> {
    try {
      if (!plugin.getMediaSource) {
        return { url: item.url || '' }
      }
      const result = await plugin.getMediaSource(item) ?? { url: item.url }
      if (!result.url) {
        return null
      }
      // 原項目：formatAuthUrl 處理 URL 中的 Basic Auth
      return {
        url: result.url,
        headers: result.headers,
      }
    } catch (err) {
      console.error(`插件 ${plugin.name} 獲取音源失敗:`, err)
      return null
    }
  }
}
