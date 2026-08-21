/**
 * 外殼：只負責取得共用狀態（useMusicApp）並交給 UI。
 *
 * 曾經有兩套 UI 並存（舊的 ClassicUI 與 AppleUI），為的是換皮期間留條回頭路。
 * AppleUI 驗證完後舊版就沒有留著的理由了 —— 兩份 500+ 行的介面各自維護，
 * 每加一個功能都要改兩遍（收藏、同步、分類推薦都是），而使用者只會看其中
 * 一套。localStorage 的 musicfree-ui 已無作用。狀態邏輯仍然全部在
 * useMusicApp 裡，要再換皮不必動音源或播放的程式碼。
 */
import { useMusicApp } from './musicApp'
import AppleUI from './ui/AppleUI'

export default function App() {
  return <AppleUI app={useMusicApp()} />
}
