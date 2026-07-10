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
    const enhancedPlugin: Plugin = {
      ...plugin,
      name: plugin.name || name || 'Unknown',
      platform: plugin.platform || name || 'unknown',
    }
    this.plugins.push(enhancedPlugin)
    this.enabled.add(enhancedPlugin.name)
  }

  async loadFromURL(url: string, name?: string): Promise<void> {
    const plugin = await PluginRunner.loadFromURL(url)
    const enhancedPlugin: Plugin = {
      ...plugin,
      name: plugin.name || name || 'Unknown',
      platform: plugin.platform || name || 'unknown',
    }
    this.plugins.push(enhancedPlugin)
    this.enabled.add(enhancedPlugin.name)
  }

  getPlugins(): Plugin[] {
    return this.plugins
  }

  getPlugin(name: string): Plugin | undefined {
    // 大小寫不敏感匹配，修復平台名稱大小寫不匹配問題
    return this.plugins.find(p => p.name.toLowerCase() === name.toLowerCase() || p.platform.toLowerCase() === name.toLowerCase())
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
   * 搜索 - 多源聚合（去勝利者通吃）
   * 原項目：search 返回 { isEnd: true, data: [] }
   * 原項目：如果 plugin.instance.search 不存在，返回 { isEnd: true, data: [] }
   * 原項目：如果 result.data 是數組，遍歷並 resetMediaItem
   *
   * ✅ 修復：所有插件結果都要返回，不讓一個成功的插件覆蓋其他失敗的
   */
  async search(keyword: string, type?: SearchType): Promise<MusicItem[]> {
    const allResults: MusicItem[] = []
    const pluginStatus: { name: string; status: string; count: number; error?: string }[] = []
    console.log('[PluginManager.search] keyword:', keyword, 'type:', type, 'plugins:', this.plugins.length)
    
    for (const p of this.plugins) {
      console.log('[PluginManager.search] plugin:', p.name, 'enabled:', this.enabled.has(p.name), 'hasSearch:', !!p.search)
      
      // 只搜索啟用的插件
      if (!this.enabled.has(p.name)) {
        pluginStatus.push({ name: p.name, status: 'disabled', count: 0 })
        continue
      }
      
      try {
        if (!p.search) {
          console.log('[PluginManager.search] skip:', p.name, '- no search method')
          pluginStatus.push({ name: p.name, status: 'no-search', count: 0 })
          continue
        }
        
        // 原項目：const result = (await this.plugin.instance.search(query, page, type)) ?? {}
        // page 必須傳 1，不能傳 undefined（否則插件 API 參數錯誤）
        const result: any = await p.search(keyword, 1, type) ?? {}
        console.log('[PluginManager.search] result:', result, 'for:', p.name)
        
        let count = 0
        // 處理三種返回格式：
        // 1. { data: [], isEnd: true }  ← Audiomack/SoundCloud 插件
        // 2. []                         ← YouTube 插件直接返回數組
        // 3. null/undefined            ← 插件不支持該搜索類型
        if (Array.isArray(result.data)) {
          result.data.forEach((item: any) => {
            if (!item.platform) item.platform = p.name
            if (!item.source) item.source = p.name
          })
          allResults.push(...result.data)
          count = result.data.length
        } else if (Array.isArray(result)) {
          // YouTube 插件直接返回數組
          result.forEach((item: any) => {
            if (!item.platform) item.platform = p.name
            if (!item.source) item.source = p.name
          })
          allResults.push(...result)
          count = result.length
        }
        pluginStatus.push({ name: p.name, status: 'success', count })
      } catch (err: any) {
        // 錯誤不中斷循環，繼續搜索其他插件
        console.error(`插件 ${p.name} 搜索失敗:`, err)
        pluginStatus.push({ name: p.name, status: 'error', count: 0, error: err.message })
      }
    }
    
    console.log('[PluginManager.search] plugin status:', JSON.stringify(pluginStatus))
    console.log('[PluginManager.search] total results:', allResults.length)
    return allResults
  }

  /**
   * 獲取已啟用的插件列表
   */
  getEnabledPlugins(): Plugin[] {
    return this.plugins.filter(p => this.enabled.has(p.name))
  }

  /**
   * 單一插件搜索 - 只搜索指定名稱的插件
   */
  async searchForPlugin(name: string, keyword: string, type: SearchType = 'music', page: number = 1): Promise<MusicItem[]> {
    const p = this.plugins.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (!p) return []
    if (!this.enabled.has(p.name)) return []
    if (!p.search) return []
    
    try {
      const result: any = await p.search(keyword, page, type) ?? {}
      if (Array.isArray(result.data)) {
        result.data.forEach((item: any) => {
          if (!item.platform) item.platform = p.name
          if (!item.source) item.source = p.name
        })
        return result.data
      } else if (Array.isArray(result)) {
        result.forEach((item: any) => {
          if (!item.platform) item.platform = p.name
          if (!item.source) item.source = p.name
        })
        return result
      }
    } catch { /* ignore */ }
    return []
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
      const result: any = await plugin.getMediaSource(item) ?? { url: item.url }
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
