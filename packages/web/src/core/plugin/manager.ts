import { Plugin, MusicItem, SearchType } from '../types'
import { PluginRunner } from './runner'

/**
 * 把插件回傳的各種形狀統一成陣列。
 *
 * MusicFree 插件的回傳格式不只一種：search 回 { isEnd, data }，而
 * getAlbumInfo / getMusicSheetInfo 回 { musicList }，各類搜尋另有
 * albumList / artistList / sheetList。只認 data 會讓一半的方法靜默回空。
 */
function normalizeItemList(result: any): any[] {
  if (Array.isArray(result)) return result
  if (!result || typeof result !== 'object') return []
  for (const key of ['data', 'musicList', 'albumList', 'artistList', 'sheetList']) {
    if (Array.isArray(result[key])) return result[key]
  }
  return []
}

/**
 * 插件管理器
 * 完全照搬原項目 MusicFree 的實現邏輯
 */
export class PluginManager {
  private plugins: Plugin[] = []
  private enabled: Set<string> = new Set()

  /**
   * 載入插件並回傳實際註冊的名稱。
   *
   * 名稱優先採用插件自己宣告的 platform（MusicFree 插件宣告的是 platform
   * 而非 name），呼叫端傳入的 name 只當後備。這樣使用者從 URL 安裝時不必
   * 手填名稱，也避免手填值與插件回傳 item.platform 不一致導致搜尋派發失敗。
   * 回傳名稱是必要的：註冊名可能與傳入的 name 不同，啟用時要用實際的那個。
   */
  loadPlugin(code: string, name?: string): string {
    const plugin = PluginRunner.load(code)
    const resolvedName = plugin.name || plugin.platform || name || 'Unknown'
    const enhancedPlugin: Plugin = {
      ...plugin,
      name: resolvedName,
      platform: plugin.platform || resolvedName,
    }
    // 同名視為重裝/升級：換掉舊的那份，不要並存。
    // 否則 getEnabledPlugins() 會回兩份同一個插件，搜尋跑兩次、結果整批重複，
    // 而 getPlugin() 用 find 只看到第一份，版號也永遠顯示舊的。
    const existing = this.plugins.findIndex(
      p => p.name === resolvedName || p.platform === enhancedPlugin.platform,
    )
    if (existing >= 0) {
      this.plugins[existing] = enhancedPlugin
    } else {
      this.plugins.push(enhancedPlugin)
    }
    this.enabled.add(enhancedPlugin.name)
    return resolvedName
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
    
    // 錯誤往外丟：第三方插件壞掉時，靜默回空陣列會讓使用者看到「未找到結果」，
    // 完全無法分辨是真的沒有這首歌、還是插件出錯
    const result: any = await p.search(keyword, page, type) ?? {}
    return this.tagItems(normalizeItemList(result), p.name)
  }

  /** 補上 platform/source，讓 app 不必知道 item 來自哪個插件 */
  private tagItems(items: any[], pluginName: string): MusicItem[] {
    items.forEach((item: any) => {
      if (!item.platform) item.platform = pluginName
      if (!item.source) item.source = pluginName
    })
    return items as MusicItem[]
  }

  /**
   * 推薦歌曲。musicweb 擴充介面（非 MusicFree 標準），插件未實作時回 null，
   * 讓 UI 能明確告知「此音源不支援推薦」而不是顯示空清單。
   */
  async getRecommendForPlugin(
    name: string, mode: string, limit = 40,
  ): Promise<MusicItem[] | null> {
    const p = this.plugins.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (!p || !this.enabled.has(p.name)) return null
    const fn = (p as any).getRecommend
    if (typeof fn !== 'function') return null
    const result: any = await fn.call(p, mode, limit) ?? {}
    return this.tagItems(normalizeItemList(result), p.name)
  }

  /** 專輯內曲目。插件未實作時回 null */
  async getAlbumInfoForPlugin(
    name: string, albumItem: MusicItem,
  ): Promise<MusicItem[] | null> {
    const p = this.plugins.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (!p || !this.enabled.has(p.name)) return null
    const fn = (p as any).getAlbumInfo
    if (typeof fn !== 'function') return null
    const result: any = await fn.call(p, albumItem) ?? {}
    return this.tagItems(normalizeItemList(result), p.name)
  }

  /**
   * 獲取音源 URL - 完全照搬原項目 getMediaSource 邏輯
   * 原項目：{ url, headers, userAgent }
   * 原項目：如果沒有 getMediaSource，直接返回 musicItem.url
   */
  // 錯誤往外丟（不再 catch 成 null）：播放失敗的原因只有插件知道，
  // 吞掉之後 UI 只能說「無法獲取音源」，使用者與開發者都無從判斷。
  async getMediaSource(plugin: Plugin, item: MusicItem): Promise<{ url: string; headers?: Record<string, string> } | null> {
    if (!plugin.getMediaSource) {
      return item.url ? { url: item.url } : null
    }
    const result: any = await plugin.getMediaSource(item) ?? { url: item.url }
    if (!result.url) return null
    return {
      url: result.url,
      headers: result.headers,
    }
  }
}
