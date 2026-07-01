import { PluginManager } from './src/plugin/manager'
import { readFileSync } from 'fs'

// 加載示例插件
const demoPlugin = readFileSync('./examples/demo-plugin.js', 'utf-8')

const manager = new PluginManager()
manager.loadPlugin(demoPlugin, 'demo')

console.log('加載插件成功！')
console.log('插件列表:', manager.getPlugins())

// 測試搜索
const results = await manager.search('測試歌曲')
console.log('搜索結果:', results)
