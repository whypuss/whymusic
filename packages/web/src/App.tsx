/**
 * 外殼：只負責取得共用狀態（useMusicApp）並決定套哪張皮。
 *
 * 兩套 UI 並存而不是直接換掉舊的 —— 舊介面已經驗證過一輪，留著才能比較，
 * 也才有回頭路。選擇記在 localStorage。
 */
import { useState } from 'react'
import { useMusicApp } from './musicApp'
import ClassicUI from './ui/ClassicUI'
import AppleUI from './ui/AppleUI'

const STORAGE_UI = 'musicfree-ui'
type UiStyle = 'apple' | 'classic'

export default function App() {
  const app = useMusicApp()
  const [ui, setUi] = useState<UiStyle>(() => {
    const saved = localStorage.getItem(STORAGE_UI)
    return saved === 'classic' ? 'classic' : 'apple'
  })

  const switchUi = (next: UiStyle) => {
    localStorage.setItem(STORAGE_UI, next)
    setUi(next)
  }

  return ui === 'classic'
    ? <ClassicUI app={app} onSwitchUi={() => switchUi('apple')} />
    : <AppleUI app={app} onSwitchUi={() => switchUi('classic')} />
}
