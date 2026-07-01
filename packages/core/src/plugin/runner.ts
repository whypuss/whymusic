import { Plugin } from '../types'

/**
 * 插件沙箱環境
 */
export class PluginRunner {
  /**
   * 加載並執行插件代碼
   * @param code 插件源代碼
   * @returns 插件實例
   */
  static load(code: string): Plugin {
    const ctx: PluginContext = {
      Platform: 'musicfree-web',
      Version: '1.0.0',
    }

    // 將插件代碼包裝成函數並執行
    const pluginFn = new Function(
      'ctx',
      'module',
      'exports',
      code
    )

    const module = { exports: {} as Plugin }
    pluginFn(ctx, module, module.exports)

    if (!module.exports || typeof module.exports !== 'object') {
      throw new Error('插件未正確導出 Plugin 對象')
    }

    return module.exports
  }

  /**
   * 從 URL 加載插件
   */
  static async loadFromURL(url: string): Promise<Plugin> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`獲取插件失敗: ${response.status} ${response.statusText}`)
    }
    const code = await response.text()
    return this.load(code)
  }
}

/**
 * 插件執行時的上下文
 */
interface PluginContext {
  Platform: string
  Version: string
}
