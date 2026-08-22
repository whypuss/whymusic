/**
 * 輕量 i18n。gettext 風格：**繁中原文就是 key**。
 *
 * 為什麼不用 i18next：這個 app 的字串不到一百條，用不上複數引擎、命名空間、
 * 懶加載那些能力，卻要多揹 40KB 依賴。這裡 50 行解決，且沿用本專案
 * 「零依賴、產物精簡」的一貫取向。
 *
 * 為什麼 key 用原文而不是 'settings.quality.title' 這種代號：
 *   - 替換點一眼看得懂在顯示什麼，review 不用對字典
 *   - 缺譯自動回退繁中 —— 顯示原文永遠好過顯示 'settings.quality.title'
 *   - 新增字串不用發明代號，寫了就能跑，翻譯之後補
 *
 * 複數：刻意不做。像俄語這種 1/2/5 三種變格的語言，翻譯時用「冒號式」
 * 寫法（Импортировано: {n}）繞開 —— 這是 UI 翻譯的常規手法，
 * 換一個複數引擎並不值得。
 */
import { useSyncExternalStore } from 'react'
import { STRINGS } from './i18n-strings'

export type Lang = 'zh-Hant' | 'zh-Hans' | 'en' | 'ja' | 'ko' | 'ru' | 'es' | 'pt'

/** 語言選單用：各語言用自己的名字稱呼自己，找母語的人一眼就認得 */
export const LANGS: { value: Lang; label: string }[] = [
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ru', label: 'Русский' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
]

const STORAGE_LANG = 'whymusic-lang'

/** 由系統語言猜初始語言。zh 的繁簡以地區分：TW/HK/MO 繁，其餘簡 */
export function detectLang(): Lang {
  for (const raw of navigator.languages || [navigator.language]) {
    const tag = String(raw || '').toLowerCase()
    if (tag.startsWith('zh')) {
      return /hant|tw|hk|mo/.test(tag) ? 'zh-Hant' : 'zh-Hans'
    }
    for (const l of ['ja', 'ko', 'ru', 'es', 'pt', 'en'] as const) {
      if (tag.startsWith(l)) return l
    }
  }
  return 'en'
}

const readStored = (): Lang | null => {
  const v = localStorage.getItem(STORAGE_LANG)
  return LANGS.some(l => l.value === v) ? (v as Lang) : null
}

/** null = 跟隨系統。分開存，語言選單才能顯示「跟隨系統」這個選項的選中狀態 */
let stored: Lang | null = null
try { stored = readStored() } catch { /* localStorage 不可用就永遠跟隨系統 */ }
let current: Lang = stored || detectLang()

const listeners = new Set<() => void>()

export const getLang = (): Lang => current
/** 目前是否「跟隨系統」（沒有手動選過語言） */
export const isAutoLang = (): boolean => stored === null

export function setLang(lang: Lang | 'auto'): void {
  try {
    if (lang === 'auto') localStorage.removeItem(STORAGE_LANG)
    else localStorage.setItem(STORAGE_LANG, lang)
  } catch { /* 存不進去就只影響這一次 */ }
  stored = lang === 'auto' ? null : lang
  current = stored || detectLang()
  listeners.forEach(f => f())
}

/** React 元件訂閱語言：語言一換，用到它的樹整棵重繪，所有 t() 重新取值 */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    getLang,
  )
}

/**
 * 翻譯。key 就是繁中原文；{name} 佔位符用 params 填。
 * 缺譯回退繁中原文 —— 使用者看到的是正常句子，只是語言不對，遠好過看到代號。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = current === 'zh-Hant' ? null : STRINGS[current]
  let out = (dict && dict[key]) || key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.split(`{${k}}`).join(String(v))
    }
  }
  return out
}
