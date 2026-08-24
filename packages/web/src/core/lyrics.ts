/**
 * LRC 歌詞解析。
 *
 * 上游給的是標準 LRC：`[mm:ss.xx]歌詞`，逐行（不是逐字 —— 這個資料源沒有
 * 卡拉OK式的字級時間軸，行級高亮就是上限）。
 *
 * 兩個實測踩到的形狀，解析時要處理：
 *
 * 1. **開頭十幾行是製作人員名單** ——「唱 : 雷同二友」「曲 : 謝芊彤」
 *    「電結他 Electric Guitars : Moo@WHIZZ」…，時間戳每行差 1 秒全部擠在
 *    前 15 秒。照播的話開場十幾秒瘋狂滾動、真正的第一句還沒到。所以把
 *    「短冒號行」判為名單濾掉 —— 判斷條件是含冒號、且冒號左邊很短（欄位名
 *    不會長），這比「前 N 行一律丟」安全：有些歌真的一開頭就唱。
 *
 * 2. **一行多個時間戳** ——`[00:12.00][01:20.00]副歌`（重複段落共用一行）。
 *    要展開成多筆，否則第二次唱到時不會高亮。
 */

export type LyricLine = { time: number; text: string }

/** `[mm:ss.xx]` / `[mm:ss:xx]` / `[mm:ss]`，小數位 1~3 位都見過 */
const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/**
 * 製作人員名單行：`欄位 : 值`。
 *
 * 只看有沒有冒號分隔，不限制欄位名長度 —— 實測欄位名經常是中英雙語，
 * 「电结他 Electric Guitars : Moo@WHIZZ」左邊就 22 字，用長度上限一定漏。
 * 誤殺歌詞的風險靠「只在開頭連續區塊套用」擋掉（見 parseLrc）。
 */
const CREDIT = /^[^:：]+\s*[:：]\s*\S/

/** LRC 純文字 → 有序的行陣列。空歌詞、純文字（無時間戳）都回空陣列 */
export function parseLrc(raw: string): LyricLine[] {
  const out: LyricLine[] = []
  /**
   * 還在開頭的名單區塊裡。名單一定是連續的一段（唱→曲→詞→編→監→樂手…），
   * 所以只在真正的第一句歌詞出現**之前**濾冒號行 —— 之後就算歌詞裡有冒號
   * （英文歌的 "Baby: come on" 之類）也不會被誤刪。
   */
  let inCredits = true
  for (const line of String(raw || '').split(/\r?\n/)) {
    TAG.lastIndex = 0
    const stamps: number[] = []
    let m: RegExpExecArray | null
    while ((m = TAG.exec(line)) !== null) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac)
    }
    if (stamps.length === 0) continue
    const text = line.replace(TAG, '').trim()
    if (!text) continue
    if (inCredits) {
      if (CREDIT.test(text)) continue
      inCredits = false
    }
    // 同一行的多個時間戳各算一筆（重複段落）
    for (const time of stamps) out.push({ time, text })
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

/**
 * 目前該高亮第幾行。回 -1 表示還沒到第一句（前奏）。
 *
 * 用二分搜尋而不是 findIndex：這個函式跟著 timeupdate 每秒跑，歌詞有上百行，
 * 沒必要每次線性掃。
 */
export function currentLyricIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0 || time < lines[0].time) return -1
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lines[mid].time <= time) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * 給「複製歌詞」用的純文字：去掉時間戳，一行一句。
 *
 * 用解析後的結果而不是原始 LRC —— 貼出去的東西不該帶 `[00:31.02]` 這種
 * 給程式看的標記，也不該帶製作人員名單。
 */
export function lyricsToText(lines: LyricLine[]): string {
  return lines.map(l => l.text).join('\n')
}
