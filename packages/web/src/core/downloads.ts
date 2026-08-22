/**
 * 下載的曲目。同一份程式碼要在兩種宿主上做同一件事，但手段完全不同：
 *
 *   網頁版：把音訊抓成 blob，用一個隱形的 <a download> 觸發瀏覽器另存。存到哪裡
 *     是瀏覽器與使用者的事，我們無從得知，也沒有「已下載清單」可言。
 *
 *   APK：WebView 裡那招沒有用 —— 沒有下載列、沒有檔案總管介面，點了等於沒事。
 *     所以改成用 Capacitor 的 Filesystem 真的寫進 app 的儲存空間，並自己記一份
 *     清單（歌名、歌手、實際音質、大小、路徑），這樣才有「設置頁看得到、可以
 *     單獨導出」這回事。
 *
 * 匯出走系統分享面板（@capacitor/share）而不是直接寫公用目錄：Android 10 之後
 * 寫公用 Music/Documents 需要額外權限，而分享面板不需要任何權限，還能讓使用者
 * 自己決定丟去哪（檔案、雲端硬碟、傳給別人），對使用者也更好懂。
 */
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { isNative } from './native'
import { t } from './i18n'

/** 一首下載好的歌。存在 localStorage，音訊本體在檔案系統 */
export type DownloadedTrack = {
  /** 曲目識別（platform::id），用來判斷「這首下載過了嗎」 */
  key: string
  title: string
  artist: string
  /** 實際存下來的音質（kbps）。可能低於使用者選的 —— 音源會降級 */
  bitrate?: number
  /** 檔案大小（bytes） */
  size: number
  /** app 儲存空間內的相對路徑。只有原生模式有 */
  path?: string
  /** 下載時間 */
  at: number
}

const STORAGE_DOWNLOADS = 'musicfree-downloads'
/** 放在 app 專屬的外部儲存空間底下，不需要任何權限 */
const DOWNLOAD_DIR = 'downloads'

export const downloadKey = (platform: string, id: string) => `${platform || ''}::${id}`

export const readDownloads = (): DownloadedTrack[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_DOWNLOADS) || '[]')
    return Array.isArray(raw) ? raw.filter((d: any) => d && d.key) : []
  } catch {
    return []
  }
}

const writeDownloads = (list: DownloadedTrack[]) => {
  try {
    localStorage.setItem(STORAGE_DOWNLOADS, JSON.stringify(list))
  } catch (e) {
    console.error('[download] 清單寫入失敗:', e)
  }
}

/** 檔名安全化。歌名可能有 / : * ? 這些檔案系統不接受的字元 */
const safeName = (title: string, artist: string, ext: string) => {
  const base = [title, artist].filter(Boolean).join(' - ') || 'song'
  return `${base.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80)}.${ext}`
}

/** 由 content-type 猜副檔名。無損是 flac，其餘按類型 */
export const extFromContentType = (contentType: string): string => {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('flac')) return 'flac'
  if (ct.includes('ogg')) return 'ogg'
  if (ct.includes('wav')) return 'wav'
  if (ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac')) return 'm4a'
  return 'mp3'
}

/** ArrayBuffer → base64。Capacitor 的 writeFile 只吃 base64 字串 */
const toBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf)
  let binary = ''
  // 分塊處理：一次把整個檔案展開成參數會爆掉呼叫堆疊（無損檔有 30MB+）
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

/**
 * 把音訊資料存起來。
 *
 * 原生：寫進 app 專屬外部儲存的 downloads/，回傳可記錄的 metadata。
 * 網頁：走瀏覽器另存，不留清單（我們無從得知它存到哪、也管不到）。
 */
export async function saveTrack(opts: {
  key: string
  title: string
  artist: string
  bitrate?: number
  data: ArrayBuffer
  contentType: string
}): Promise<DownloadedTrack | null> {
  const ext = extFromContentType(opts.contentType)
  const fileName = safeName(opts.title, opts.artist, ext)

  if (!isNative()) {
    const blob = new Blob([opts.data], { type: opts.contentType || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return null
  }

  const path = `${DOWNLOAD_DIR}/${fileName}`
  await Filesystem.mkdir({
    path: DOWNLOAD_DIR, directory: Directory.External, recursive: true,
  }).catch(() => { /* 已存在 */ })
  await Filesystem.writeFile({
    path, directory: Directory.External, data: toBase64(opts.data), recursive: true,
  })

  const record: DownloadedTrack = {
    key: opts.key,
    title: opts.title,
    artist: opts.artist,
    bitrate: opts.bitrate,
    size: opts.data.byteLength,
    path,
    at: Date.now(),
  }
  // 同一首重下就覆蓋那一筆，不要累積重複列
  writeDownloads([record, ...readDownloads().filter(d => d.key !== record.key)])
  return record
}

/** 把已下載的檔案交給系統分享面板，讓使用者存去別的地方 */
export async function exportTrack(track: DownloadedTrack): Promise<void> {
  if (!isNative() || !track.path) {
    throw new Error(t('這個版本沒有本機下載清單，匯出只在 App 版可用'))
  }
  const { uri } = await Filesystem.getUri({
    path: track.path, directory: Directory.External,
  })
  await Share.share({
    title: track.title,
    text: `${track.title} - ${track.artist}`,
    url: uri,
    dialogTitle: t('匯出到…'),
  })
}

/**
 * 匯出一個文字檔（例如收藏的 .md）。與音訊下載同一個分歧：
 *
 *   網頁版：blob + <a download> 另存。內容前面加 BOM —— 瀏覽器自己不需要，
 *     但 Windows 記事本、WPS 這類軟體開檔案時沒看到 BOM 就用系統編碼猜，
 *     中文直接變亂碼；有 BOM 就一定認出 UTF-8。匯入端的 trim() 會把它吃掉，
 *     不影響回讀。
 *
 *   APK：WebView 的 <a download> 點了等於沒事（沒有下載列）。寫進快取目錄
 *     再開系統分享面板，使用者自己決定存到「檔案」、雲端還是傳給別人。
 */
export async function exportTextFile(fileName: string, text: string): Promise<void> {
  const content = '\ufeff' + text

  if (!isNative()) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // 不立刻 revoke：Safari 有時還沒開始讀就被撤掉，下載會變成空檔
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return
  }

  await Filesystem.writeFile({
    path: fileName, directory: Directory.Cache, data: content, encoding: Encoding.UTF8,
  })
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache })
  try {
    await Share.share({ title: fileName, url: uri, dialogTitle: t('匯出到…') })
  } catch (e: any) {
    // 使用者關掉分享面板不是錯誤，不要對它彈失敗訊息
    if (/cancel/i.test(String(e?.message || e))) return
    throw e
  }
}

/** 刪掉檔案與清單裡那一筆 */
export async function deleteTrack(track: DownloadedTrack): Promise<void> {
  if (isNative() && track.path) {
    await Filesystem.deleteFile({
      path: track.path, directory: Directory.External,
    }).catch(e => console.warn('[download] 刪檔失敗（清單仍會移除）:', e))
  }
  writeDownloads(readDownloads().filter(d => d.key !== track.key))
}

/** 人看得懂的檔案大小 */
export const formatSize = (bytes: number): string => {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}
