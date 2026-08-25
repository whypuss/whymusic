/**
 * WhyMusic 聚合音源 —— Cloudflare Pages Functions 版共用模組
 *
 * 這份是 packages/web/scripts/server.mjs 裡 WhyMusic 區段的移植版。子音源扇出、
 * 繁簡歸一化、跨子源救援等邏輯與自托管版本一致（該區段本身只用 fetch，可直接
 * 移植）；差異只有兩處：
 *   1. 設定值改為模組常數 —— Workers 沒有 process.env
 *   2. Audiomack 的 OAuth 簽名改用 Web Crypto（node:crypto 在 Workers 不可用）
 *
 * 目錄以 _ 開頭，Pages Functions 不會把它當成路由。
 */

// ── Audiomack OAuth（Web Crypto 版）──────────────────────────────
const AUDIOMACK_BASE = 'https://api.audiomack.com/v1'
const AM_KEY = 'audiomack-js'
const AM_SECRET = 'f3ac5b086f3eab260520d8e3049561e6'

function oauthEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A')
}

async function hmacSha1(key, data) {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function amSignature(method, fullUrl, params) {
  const base = [
    method.toUpperCase(),
    oauthEncode(fullUrl.split('?')[0]),
    oauthEncode(Object.keys(params).sort()
      .map(k => `${oauthEncode(k)}=${oauthEncode(String(params[k]))}`).join('&')),
  ].join('&')
  return await hmacSha1(`${oauthEncode(AM_SECRET)}&`, base)
}

/** OAuth 共用參數。nonce 用 Web Crypto 取隨機值（node 版用 randomBytes） */
function amBaseParams(extra) {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const nonce = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return {
    oauth_consumer_key: AM_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...extra,
  }
}

/** 簽名不再二次編碼（Audiomack 端要求），與 node 版一致 */
function amQuery(params) {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${k === 'oauth_signature' ? v : oauthEncode(v)}`).join('&')
}

async function amFetchJson(fullUrl, params) {
  params.oauth_signature = await amSignature('GET', fullUrl, params)
  const response = await fetch(`${fullUrl}?${amQuery(params)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Origin': 'https://audiomack.com',
    },
  })
  if (!response.ok) throw new Error(`Audiomack API error: ${await response.text()}`)
  return await response.json()
}

async function searchAudiomack(keyword, type, page) {
  const params = amBaseParams({
    q: keyword,
    page: String(page || 1),
    limit: '20',
    show: type === 'music' ? 'songs' : type === 'album' ? 'albums'
      : type === 'artist' ? 'artists' : 'playlists',
    sort: 'popular',
  })
  const data = await amFetchJson(`${AUDIOMACK_BASE}/search`, params)
  return (data.results || []).map(item => {
    const artistObj = item.artist || ''
    const trackArray = (type === 'album' || type === 'sheet') && item.tracks
      ? (Array.isArray(item.tracks) ? item.tracks : Object.values(item.tracks)) : []
    return {
      id: item.id || '',
      title: item.title || item.name || '',
      artist: typeof artistObj === 'string'
        ? artistObj : (artistObj.name || item.artistName || item.uploader || ''),
      artwork: item.image || item.image_base || item.artwork_url || item.cover_url || '',
      duration: item.duration || 0,
      url_slug: item.url_slug || '',
      type: type === 'album' ? 'album' : type === 'sheet' ? 'sheet'
        : (type === 'artist' ? 'artist' : 'music'),
      musicList: trackArray.map((t, i) => ({
        id: t.song_id || t.id || `${item.id}-track-${i}`,
        title: t.title || '',
        artist: t.artist || item.artistName || item.uploader || '',
        artwork: t.cover_url || t.artwork_url || item.image_base || item.image || '',
        duration: parseInt(t.duration, 10) || 0,
        type: 'music',
      })).filter(t => t.title),
    }
  })
}

async function getAudiomackMedia(songId) {
  const params = amBaseParams({ environment: 'desktop-web', hq: 'true', section: '/search' })
  const data = await amFetchJson(`${AUDIOMACK_BASE}/music/play/${songId}`, params)
  return data.signedUrl || ''
}

async function getAudiomackAlbumOrSheet(id, slug, artist) {
  if (!slug || !artist) return { error: '缺少 slug 或 artist' }
  const params = amBaseParams({})
  const data = await amFetchJson(`${AUDIOMACK_BASE}/album/${artist}/${slug}`, params)
  const raw = data.results || data
  const tracks = raw.tracks
    ? (Array.isArray(raw.tracks) ? raw.tracks : Object.values(raw.tracks)) : []
  return tracks.map((item, index) => ({
    id: item.song_id || item.id || `${id}-track-${index}`,
    title: item.title || '',
    artist: item.artist || artist,
    artwork: item.cover_url || item.artwork_url || '',
    duration: parseInt(item.duration, 10) || 0,
    type: 'music',
  })).filter(t => t.title)
}

/** JSON 回應（含 CORS，與自托管版一致） */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // 不帶 Cache-Control 的話 Cloudflare 邊緣會自行快取這些 GET 回應，
      // 換版之後同一個 query 可能拿到舊部署的內容（實測踩過：某個 /api/ 路徑
      // 回了 worker 存在之前的 index.html）。上游回應的快取由後端自己的
      // TTL cache 負責，邊緣不該再插手。
      'Cache-Control': 'no-store',
    },
  })
}

// ── WhyMusic（本站聚合音源）────────────────────────────────────────
// 對外只呈現一個來源 WhyMusic，底下扇出到多個子音源：
//   netease / joox  → 經上游 GD Music API（music-api.gdstudio.xyz）代理
//   audiomack       → 走本站自己的 OAuth 實作（searchAudiomack / getAudiomackMedia）
// 三者各自補足對方的缺口：netease 簡體曲庫最全、joox 港台繁體與粵語 live 版本多、
// audiomack 則是歐美獨立音樂 / hip-hop / afrobeats。
//
// 未納入的來源與原因：
//   kuwo      url 端點恆回空字串（2026-08-18 實測）
//   bilibili  回 HTML，搜得到但播不出來
//   YouTube   全 client 需 PoToken/BotGuard，非本站能修
//   audiomack 播放不穩：URL 解析成功但常在客戶端播不出來，且疑似有地域限制
//             （同一首歌從不同地區的 CF 邊緣結果不同）。它獨有的曲目沒有替代
//             來源可救援，留著只會讓使用者隨機撞到放不出來的歌。
const GD_API = 'https://music-api.gdstudio.xyz/api.php'

/** audiomack 不由 GD 代理，需與其餘子源分流處理 */
const AUDIOMACK_SOURCE = 'audiomack'

const WHY_SOURCES = ('netease,joox')
  .split(',').map(s => s.trim()).filter(Boolean)
/** 由上游 GD API 代理的子源 */
const GD_SOURCES = WHY_SOURCES.filter(s => s !== AUDIOMACK_SOURCE)
const GD_BITRATE = 320

// 推薦頁的五個分類，一個分類對一份網易雲榜單（與 plugins/whymusic.js 的
// CATEGORIES 是同一份對應，兩邊都要能獨立運作：插件先問這裡，這裡不通它才直連）。
//
// 這個端點存在的意義就是**把量壓下來**：榜單原始回應 200KB–2.4MB（叱咤903 是
// 1000 首／2.4MB），瀏覽器直連要 4 秒以上，而這裡抓過一次就進 TTL 快取、對外
// 只回裁切後的幾十首 ≈ 15KB，全站共用。
//
// 榜單本身已排好序（排行榜的順序就是它的意義），所以不再有「最新／熱門」兩種排法。
// orders 是這份榜單要用幾種順序取樣（同一份抓回來的資料排兩次，不會多打上游）：
//   chart — 榜單本身的順序（叱咤榜是按發行時間降序，也就是「最新」）
//   pop   — 按網易雲的 pop 熱度降序，也就是「熱門」
// 粵語兩種都要：叱咤榜有 1000 首，光看原順序只會看到最近幾週發行的，那些真正
// 紅的粵語歌反而看不到。
const GD_CATEGORIES = {
  hot: { list: '3778678', orders: ['chart'] },          // 熱歌榜（每小時更新，跨語種總熱門）
  cantonese: { list: '5097494848', orders: ['chart', 'pop'] }, // 叱咤903 —— 唯一還在更新的粵語榜
  cpop: { list: '3779629', orders: ['chart'] },         // 新歌榜（華語為主，每天更新）
  kpop: { list: '745956260', orders: ['chart'] },       // 韓語榜（每天更新）
  western: { list: '2809513713', orders: ['chart'] },   // 歐美熱歌榜（每天更新）
}

/**
 * 一份榜單按指定順序排列。
 *   chart — 原順序（榜單自己排好的）
 *   pop   — 熱度降序；同熱度以發行時間新者優先，否則前段會擠滿一堆 pop=100
 *           的曲目而順序毫無意義
 */
function sortTracks(tracks, order) {
  if (order !== 'pop') return tracks
  return [...tracks].sort((a, b) =>
    ((b.pop ?? 0) - (a.pop ?? 0)) || ((b.publishTime ?? 0) - (a.publishTime ?? 0)))
}
const DEFAULT_CATEGORY = 'cantonese'
/** 給路由層驗證用（收到沒見過的 cat 就退回預設） */
const RECOMMEND_CATEGORIES = Object.keys(GD_CATEGORIES)

// 上游按 IP 限流，而本服務所有使用者共用同一出口 IP，故一律走 TTL 快取。
// playlist 是榜單：前端每次開都會來拿，所以這層快取決定使用者實際看到的新鮮度。
// 10 分鐘 —— 短到榜單一動就跟上，長到不會讓每個訪客都去打一次 2.4MB 的上游。
const GD_TTL = { search: 600e3, url: 1200e3, pic: 864e5, lyric: 864e5, playlist: 600e3 }
const GD_CACHE_MAX = 500
const gdCache = new Map()

function gdCacheGet(key) {
  const hit = gdCache.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expires) {
    gdCache.delete(key)
    return undefined
  }
  return hit.value
}

function gdCacheSet(key, value, ttl) {
  // 到上限就從最舊的開始清（Map 保留插入順序），清到八成滿為止
  if (gdCache.size >= GD_CACHE_MAX) {
    for (const k of gdCache.keys()) {
      gdCache.delete(k)
      if (gdCache.size <= GD_CACHE_MAX * 0.8) break
    }
  }
  gdCache.set(key, { value, expires: Date.now() + ttl })
}

async function gdRequest(types, params) {
  const query = new URLSearchParams({ types, ...params }).toString()
  const cached = gdCacheGet(query)
  if (cached !== undefined) return cached

  const response = await fetch(`${GD_API}?${query}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // 上游對不支援的參數組合會回 HTML 錯誤頁
    throw new Error(`GD Music 回應非 JSON (HTTP ${response.status}): ${text.slice(0, 120)}`)
  }
  if (!response.ok || data?.detail) {
    throw new Error(`GD Music API error: ${data?.detail || `HTTP ${response.status}`}`)
  }
  gdCacheSet(query, data, GD_TTL[types] || 600e3)
  return data
}

// 繁 → 簡 常用字對照：上游（網易雲）資料多為簡體，本站 UI 與 Audiomack
// 曲目多為繁體，跨源比對同一首歌時需要歸一化（「浮誇」↔「浮夸」）。
const GD_T2S = {
  傑: '杰', 倫: '伦', 週: '周', 風: '风', 東: '东', 華: '华', 國: '国', 學: '学',
  對: '对', 說: '说', 記: '记', 開: '开', 關: '关', 點: '点', 機: '机', 電: '电',
  車: '车', 門: '门', 問: '问', 間: '间', 見: '见', 話: '话', 實: '实', 書: '书',
  長: '长', 認: '认', 識: '识', 飛: '飞', 魚: '鱼', 鳥: '鸟', 馬: '马', 龍: '龙',
  雲: '云', 霧: '雾', 頭: '头', 頁: '页', 項: '项', 順: '顺', 須: '须', 體: '体',
  誇: '夸', 愛: '爱', 樂: '乐', 夢: '梦', 淚: '泪', 戀: '恋', 願: '愿', 歲: '岁',
  舊: '旧', 過: '过', 還: '还', 這: '这', 個: '个', 們: '们', 來: '来', 時: '时',
  後: '后', 從: '从', 當: '当', 應: '应', 該: '该', 離: '离', 別: '别', 遠: '远',
  邊: '边', 裡: '里', 內: '内', 萬: '万', 億: '亿', 聽: '听', 觀: '观', 讀: '读',
  寫: '写', 語: '语', 詞: '词', 詩: '诗', 聲: '声', 響: '响', 靜: '静', 續: '续',
  終: '终', 結: '结', 緣: '缘', 總: '总', 經: '经', 歷: '历', 變: '变', 換: '换',
  轉: '转', 動: '动', 靈: '灵', 獨: '独', 單: '单', 雙: '双', 誰: '谁', 為: '为',
  無: '无', 沒: '没', 給: '给', 將: '将', 帶: '带', 讓: '让', 覺: '觉', 錯: '错',
  難: '难', 歡: '欢', 樣: '样', 麼: '么', 嗎: '吗', 傷: '伤', 錢: '钱', 醫: '医',
}

/** 歸一化歌名/歌手：去括號註記、去標點空白、繁轉簡、轉小寫 */
function gdNormalizeName(text) {
  const stripped = String(text || '')
    .toLowerCase()
    // 去掉 (Live)、（電視劇主題曲）、[Explicit] 這類註記
    .replace(/[（([【].*?[)）\]】]/g, '')
    .replace(/[\s\-_·・,，.。!！?？'"'"、/\\|&+]/g, '')
  let out = ''
  for (const ch of stripped) out += GD_T2S[ch] || ch
  return out
}

/** 判斷搜尋結果是否為目標歌曲（歌名相符 + 歌手互相包含，支援繁簡） */
function gdIsSameSong(candidate, target) {
  const ct = gdNormalizeName(candidate.title)
  const tt = gdNormalizeName(target.title)
  if (!ct || !tt) return false
  if (ct !== tt && !ct.startsWith(tt) && !tt.startsWith(ct)) return false
  const ta = gdNormalizeName(target.artist)
  if (!ta) return true  // 目標無歌手資訊，歌名相符即可
  const ca = gdNormalizeName(candidate.artist)
  if (!ca) return false
  // 歌手可能是「陳奕迅 / MissG」這種拼接，歸一化後互相包含即算命中
  return ca.includes(ta) || ta.includes(ca)
}

/** GD 歌曲 → 本站 MusicItem */
function gdNormalizeSong(raw, fallbackSource) {
  const artist = Array.isArray(raw.artist)
    ? raw.artist.filter(Boolean).join(' / ')
    : String(raw.artist || '')
  return {
    id: String(raw.url_id || raw.id || ''),
    title: String(raw.name || ''),
    artist,
    album: String(raw.album || ''),
    platform: 'WhyMusic',
    // GD 的子音源（netease / joox…），播放時要原樣帶回上游
    subSource: String(raw.source || fallbackSource || ''),
    picId: raw.pic_id ? String(raw.pic_id) : '',
    lyricId: raw.lyric_id ? String(raw.lyric_id) : '',
    type: 'music',
  }
}

/** Audiomack 搜尋結果 → WhyMusic MusicItem */
function audiomackToWhyItem(raw) {
  return {
    id: String(raw.id || ''),
    title: String(raw.title || ''),
    artist: String(raw.artist || ''),
    album: '',
    platform: 'WhyMusic',
    subSource: AUDIOMACK_SOURCE,
    artwork: raw.artwork || '',
    duration: raw.duration || 0,
    // Audiomack 的專輯/歌單端點需要 slug 才能還原，music 類型留著不影響
    urlSlug: String(raw.url_slug || ''),
    picId: '',
    lyricId: '',
    type: 'music',
  }
}

/**
 * Audiomack 的專輯/歌單/歌手結果 → WhyMusic。
 * 外層與內層 musicList 都要改掛，否則點進專輯後每首歌的 platform 仍是
 * Audiomack，會走錯播放分支。
 */
function audiomackContainerToWhyItem(raw) {
  return {
    ...raw,
    platform: 'WhyMusic',
    subSource: AUDIOMACK_SOURCE,
    musicList: (raw.musicList || []).map(track => ({
      ...track,
      platform: 'WhyMusic',
      subSource: AUDIOMACK_SOURCE,
    })),
  }
}

/** 取單一子源的搜尋結果：audiomack 走自家 OAuth，其餘經 GD 上游 */
async function searchWhySubSource(source, keyword, page, count) {
  if (source === AUDIOMACK_SOURCE) {
    const list = await searchAudiomack(keyword, 'music', page)
    return list.map(audiomackToWhyItem)
  }
  const data = await gdRequest('search', {
    source, name: keyword, count: String(count), pages: String(page),
  })
  return Array.isArray(data) ? data.map(raw => gdNormalizeSong(raw, source)) : []
}

/** 多源並發搜尋：各源輪流取一首後合併，同名同歌手去重 */
async function searchWhyMusic(keyword, page = 1, count = 20) {
  const settled = await Promise.allSettled(
    WHY_SOURCES.map(source => searchWhySubSource(source, keyword, page, count)),
  )
  const buckets = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    console.error(`[why] search failed on ${WHY_SOURCES[i]}: ${r.reason?.message}`)
    return []
  })
  // 全部子源都失敗時要拋錯，不能回空陣列。「查無此歌」和「上游整個連不上」若都
  // 顯示成一片空白，使用者只能猜是沒這首歌、還是程式壞了 —— GD 開始擋 Cloudflare
  // Worker 時就是這樣悶了一段時間才被發現。
  if (settled.every(r => r.status === 'rejected')) {
    throw new Error(
      `所有子音源都失敗：${settled.map((r, i) => `${WHY_SOURCES[i]}（${r.reason?.message}）`).join('；')}`,
    )
  }

  const seen = new Set()
  const merged = []
  const maxLen = Math.max(0, ...buckets.map(b => b.length))
  for (let idx = 0; idx < maxLen; idx++) {
    for (const bucket of buckets) {
      const item = bucket[idx]
      if (!item || !item.id || !item.title) continue
      const key = `${gdNormalizeName(item.title)}::${gdNormalizeName(item.artist)}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

async function getGdUrl(songId, source, bitrate = GD_BITRATE) {
  const data = await gdRequest('url', { source, id: songId, br: String(bitrate) })
  return data?.url || ''
}

/** 取單一子源的播放 URL：audiomack 走自家 OAuth，其餘經 GD 上游 */
async function getWhySubSourceUrl(songId, source, bitrate = GD_BITRATE) {
  if (source === AUDIOMACK_SOURCE) return await getAudiomackMedia(songId)
  return await getGdUrl(songId, source, bitrate)
}

/**
 * 取可播放的音源 URL。
 * 指定子源拿不到時（GD 上游對部分曲目回空字串、Audiomack 對授權曲目回
 * 1005 Not authorized），用歌名+歌手到其餘子源找同一首歌再試。
 * 這是跨子源救援路徑，繁簡歸一化讓「浮誇」也能在簡體源命中。
 */
async function resolveWhyMusicUrl({ id, source, bitrate, title, artist, exclude }) {
  // exclude：呼叫端已知播不出來的子源。伺服器端只看得到「解析失敗」，但有些
  // URL 解析成功卻在客戶端播不出來（CDN 對該地區回 403、容器格式不支援…），
  // 那種情況只有前端知道，所以要讓它把壞掉的子源排除後重新解析。
  const skip = new Set(Array.isArray(exclude) ? exclude : [])
  const primary = source || WHY_SOURCES[0]
  if (id && !skip.has(primary)) {
    try {
      const direct = await getWhySubSourceUrl(id, primary, bitrate)
      if (direct) return { url: direct, source: primary, id }
    } catch (err) {
      console.error(`[why] url failed ${primary}/${id}: ${err.message}`)
    }
  }

  const keyword = [title, artist].filter(Boolean).join(' ').trim()
  if (!keyword) return null
  for (const candidateSource of WHY_SOURCES) {
    if (skip.has(candidateSource)) continue
    // 主源已用 id 直取過，不重複試
    if (candidateSource === primary && id) continue
    try {
      const list = await searchWhySubSource(candidateSource, keyword, 1, 5)
      for (const candidate of list.slice(0, 3)) {
        if (!candidate.id || !gdIsSameSong(candidate, { title, artist })) continue
        const url = await getWhySubSourceUrl(candidate.id, candidateSource, bitrate)
        if (url) return { url, source: candidateSource, id: candidate.id, matched: candidate }
      }
    } catch (err) {
      console.error(`[why] fallback search failed on ${candidateSource}: ${err.message}`)
    }
  }
  return null
}

// 歌詞與封面只有 GD 代理的子源提供。Audiomack 沒有對應端點（封面在搜尋
// 結果就隨 artwork 回來了），直接回空值，不要拿 source=audiomack 去打 GD。
async function getWhyMusicLyric(lyricId, source) {
  if (source === AUDIOMACK_SOURCE) return { lyric: '', tlyric: '' }
  const data = await gdRequest('lyric', { source, id: lyricId })
  return { lyric: data?.lyric || '', tlyric: data?.tlyric || '' }
}

async function getWhyMusicPic(picId, source, size = 500) {
  if (source === AUDIOMACK_SOURCE) return ''
  const data = await gdRequest('pic', { source, id: picId, size: String(size) })
  return data?.url || ''
}

/** 推薦頁：香港叱咤903榜單（回應自帶封面，無需逐首取圖） */
/**
 * 網易雲圖床支援 ?param=寬y高 取縮圖。榜單封面原圖一張 2~3MB，一頁列表
 * 幾十張就是幾十 MB —— 光封面就能拖垮載入與流量。列表縮圖 300 已夠
 * Retina 螢幕用；播放中的大圖另走 pic 端點拿高清。順手升 https（圖床
 * 雙協定都通，http 在網頁版是 mixed content）。
 */
function thumbArtwork(picUrl) {
  const url = String(picUrl || '')
  if (!url) return ''
  if (!/\bmusic\.126\.net\//.test(url)) return url
  return url.replace(/^http:/, 'https:')
    + (url.includes('?') ? '&' : '?') + 'param=300y300'
}

/** 網易雲榜單曲目 → 本站 MusicItem（缺 id 或歌名的丟掉） */
function gdTrackToItem(track) {
  const title = String(track.name || '')
  if (!track.id || !title) return null
  const album = track.al || track.album || {}
  return {
    id: String(track.id),
    title,
    artist: (track.ar || track.artists || []).map(a => a.name).filter(Boolean).join(' / '),
    album: String(album.name || ''),
    artwork: thumbArtwork(album.picUrl),
    platform: 'WhyMusic',
    subSource: 'netease',
    picId: album.pic_str || (album.pic != null ? String(album.pic) : ''),
    lyricId: String(track.id),
    duration: track.dt ? Math.round(track.dt / 1000) : 0,
    type: 'music',
  }
}

// ── 專輯（網易雲） ──────────────────────────────────────────────────
/**
 * 網易雲的公開端點。專輯資料只有它有 —— GD 的聚合 API 沒有專輯類型
 * （types=album/albuminfo/albumlist 全部回 "not supported"）。
 *
 * **它會隨機拒絕請求**：同一個網址連打，回應在 `code: 200` 與
 * `code: -462`（要求手機驗證、資料為空、HTTP 仍是 200）之間跳。實測從
 * Cloudflare 出去的成功率只有四成左右，而從家用網路直連是百分之百 ——
 * 差別在出口 IP：CF 的出口是共用池，其中一部分被網易雲標記了，而每次請求
 * 走哪個 IP 是隨機的。
 *
 * 所以重試是有效的（換一次請求就有機會換到乾淨的 IP），而且要重試在**後端**：
 *   - 六次嘗試把成功率從 42% 拉到 96%
 *   - 成功結果進全站共用快取，第二個人點同一張專輯不必再賭一次
 *   - 前端只發一個請求，不必自己處理這個上游的怪脾氣
 */
/**
 * 同一份 API 的多個主機。實測三個都回一樣的資料，但**不會同時被擋** ——
 * 限流是按（出口 IP × 主機）算的，所以重試時換主機比原地重試有效得多：
 * 原地連試六次只有 75% 成功，輪替三個主機後實測沒有再失敗過。
 */
const NETEASE_HOSTS = [
  'https://music.163.com',
  'https://interface.music.163.com',
  'https://interface3.music.163.com',
]
/** 每個主機試幾輪。3 主機 × 2 輪 = 6 次嘗試 */
const NETEASE_ROUNDS = 2

async function neteaseFetch(path) {
  const cacheKey = `netease:${path}`
  const cached = gdCacheGet(cacheKey)
  if (cached !== undefined) return cached

  let blocked = false
  for (let round = 0; round < NETEASE_ROUNDS; round++) {
    for (const host of NETEASE_HOSTS) {
      let data
      try {
        const resp = await fetch(host + path, {
          headers: {
            Referer: 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        })
        data = await resp.json()
      } catch {
        continue  // 網路層失敗，換下一個主機
      }
      // -462 = 被要求驗證（資料是空的）→ 換主機再試
      if (data && data.code === -462) { blocked = true; continue }
      gdCacheSet(cacheKey, data, GD_TTL.playlist)
      return data
    }
  }
  throw new Error(
    blocked ? '網易雲要求驗證（上游限流），請稍後再試' : '網易雲無回應',
  )
}

/** 網易雲專輯 → 本站 MusicItem（type=album，前端據此開專輯頁而不是直接播） */
function neteaseAlbumToItem(raw) {
  if (!raw || !raw.id || !raw.name) return null
  const artists = (raw.artists || (raw.artist ? [raw.artist] : []))
    .map(a => a && a.name).filter(Boolean).join(' / ')
  return {
    id: String(raw.id),
    title: String(raw.name),
    artist: artists,
    album: String(raw.name),
    artwork: thumbArtwork(raw.picUrl || raw.blurPicUrl),
    platform: 'WhyMusic',
    subSource: 'netease',
    worksNum: Number(raw.size) || 0,
    type: 'album',
  }
}

/** 專輯搜尋（網易雲 type=10） */
async function searchWhyMusicAlbums(keyword, page = 1, limit = 20) {
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit
  const data = await neteaseFetch(
    `/api/search/get?s=${encodeURIComponent(keyword)}&type=10&limit=${limit}&offset=${offset}`,
  )
  const albums = (data && data.result && data.result.albums) || []
  return albums.map(neteaseAlbumToItem).filter(Boolean)
}

/**
 * 專輯曲目。用 /api/v1/album/{id} —— 舊的 /api/album/{id} 現在一律回
 * code -462 要求綁定手機，v1 那條不用。
 *
 * 回傳的是 netease 曲目，所以照現有的播放鏈路（resolveWhyMusicUrl）就能播。
 */
async function getWhyMusicAlbum(id) {
  const data = await neteaseFetch(`/api/v1/album/${encodeURIComponent(id)}`)
  const songs = (data && data.songs) || []
  return songs.map(gdTrackToItem).filter(Boolean)
}


/**
 * 推薦：取一份榜單、去重、裁到 limit。
 *
 * 裁切後的結果自己進快取（鍵含 limit），而不是只靠 gdRequest 快取原始回應 ——
 * 叱咤那份解析後在記憶體裡是好幾十 MB，這台機器只有 256MB，留著整份不划算。
 */
/**
 * 輪替視窗：從整份榜單裡取哪一段。
 *
 * 榜單本身很少動（叱咤一週一次、網易雲的日榜一天一次），所以就算每次開 app
 * 都重抓，同一天看到的還是那幾首 —— 使用者說的「更新頻率太慢」其實是這個。
 * 但榜單有的歌遠比我們顯示的多（粵語 1000 首、熱門與歐美 200、其餘 100，
 * 而畫面只放 80），所以換一段取就有新歌可看，不必等上游更新。
 *
 * 用時間分桶而不是每次隨機：同一段時間內重複開、切分類再切回來，看到的
 * 是同一批歌 —— 清單在使用者眼皮底下跳動比「一直是舊的」更糟。
 *
 * 一天一桶：跟榜單自己的更新節奏對齊（網易雲日榜一天一次），使用者一天內
 * 反覆開 app 看到的是同一批歌，隔天才換 —— 那是「今天的推薦」該有的樣子。
 * 更短的桶（試過 15 分鐘）會讓早上和下午看到完全不同的清單，找不回上午
 * 想聽但沒點的那首。
 *
 * 取法是「以日期桶＋榜單做種子的確定性洗牌」而不是換窗口：窗口對不足兩頁的
 * 池子（Kpop／中文去重後 ~100 首、畫面 80 首）相鄰兩天重疊七成多，看起來就
 * 像沒更新。洗牌讓池子再小每天也是全新的順序與選曲；種子一天一換，當天內
 * 反覆開 app、多台機器（CF 多個 worker）算出來的都是同一批。
 */
const ROTATE_BUCKET_MS = 24 * 60 * 60 * 1000

function dailyShuffle(list, limit, seedKey = '') {
  if (list.length === 0) return []
  let seed = Math.floor(Date.now() / ROTATE_BUCKET_MS)
  const s = String(seedKey)
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) | 0
  // mulberry32：夠均勻的小型 PRNG，Worker／Node／瀏覽器沙箱都能跑
  let a = seed >>> 0
  const rand = () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const arr = list.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
  }
  return arr.slice(0, limit)
}

async function recommendWhyMusic(category = DEFAULT_CATEGORY, limit = 40) {
  const cat = GD_CATEGORIES[category] || GD_CATEGORIES[DEFAULT_CATEGORY]
  const orders = cat.orders || ['chart']
  // 快取鍵帶上輪替桶：換了桶就是不同的一段歌，不能沿用上一桶的結果
  const bucket = Math.floor(Date.now() / ROTATE_BUCKET_MS)
  const cacheKey = `rec:${cat.list}:${orders.join('+')}:${limit}:${bucket}`
  const cached = gdCacheGet(cacheKey)
  if (cached !== undefined) return cached

  const data = await gdRequest('playlist', { source: 'netease', id: cat.list })
  const tracks = data?.playlist?.tracks || []

  // 每種順序各排一份，再輪流取一首交錯合併、同名同歌手去重。
  // 交錯而非串接：串接的話 limit 會被第一種順序吃光，第二種等於沒接上。
  const buckets = orders.map(
    order => sortTracks(tracks, order).map(gdTrackToItem).filter(Boolean),
  )
  // 先交錯合併**整份**榜單（不再邊合併邊裁到 limit）—— 要輪替就得先有完整的池子
  const seen = new Set()
  const merged = []
  const maxLen = Math.max(0, ...buckets.map(b => b.length))
  for (let idx = 0; idx < maxLen; idx++) {
    for (const b of buckets) {
      const item = b[idx]
      if (!item) continue
      const key = `${gdNormalizeName(item.title)}::${gdNormalizeName(item.artist)}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
    }
  }
  const out = dailyShuffle(merged, limit, cat.list)
  gdCacheSet(cacheKey, out, GD_TTL.playlist)
  return out
}


export {
  searchWhyMusic,
  searchWhyMusicAlbums,
  getWhyMusicAlbum,
  resolveWhyMusicUrl,
  getWhyMusicLyric,
  getWhyMusicPic,
  recommendWhyMusic,
  RECOMMEND_CATEGORIES,
  DEFAULT_CATEGORY,
  audiomackContainerToWhyItem,
  searchAudiomack,
  getAudiomackAlbumOrSheet,
  GD_BITRATE,
}
