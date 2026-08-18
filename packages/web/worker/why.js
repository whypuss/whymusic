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

// 推薦頁資料來源：香港叱咤903專業推介（商業電台的粵語流行榜，每週更新）。
// playlist 回應自帶封面、時長、發行日與熱度，不必逐首打 types=pic。
//
// 為什麼是這個榜（2026-08-18 實測）：
//   - 原本的「香港電台中文歌曲龍虎榜」(10169002) 最後更新是 2020-01-10、只有
//     13 首，「最新」推薦的其實是六年前的歌。
//   - 網易雲的新歌榜/熱歌榜/飆升榜雖然天天更新，但清一色國語內地歌，不是港樂。
//   - 叱咤903 這份更新到 2026-08-17，1000+ 首且全是粵語港樂（周國賢、陳蕾、
//     Gareth.T、MC 張天賦、Zpecial…），本身已按發行時間降序排列。
const GD_TOPLISTS = {
  // 兩個 id 都是叱咤903，前者是每週更新的主榜，後者是年度榜（備援，
  // 主榜若被刪除或改私密仍有東西可回）
  new: ['5097494848', '13483749530'],
  hot: ['5097494848', '13483749530'],
}

/**
 * 推薦排序：
 *   new — 沿用榜單原順序（叱咤榜本身最新在前）
 *   hot — 按 netease 的 pop 熱度（0–100）降序；同熱度以發行時間新者優先，
 *         否則前段會擠滿一堆 pop=100 的曲目而順序無意義
 */
function sortTracksByMode(tracks, mode) {
  if (mode !== 'hot') return tracks
  return [...tracks].sort((a, b) => {
    const popDiff = (b.pop ?? 0) - (a.pop ?? 0)
    if (popDiff !== 0) return popDiff
    return (b.publishTime ?? 0) - (a.publishTime ?? 0)
  })
}

// 上游按 IP 限流，而本服務所有使用者共用同一出口 IP，故一律走 TTL 快取。
const GD_TTL = { search: 600e3, url: 1200e3, pic: 864e5, lyric: 864e5, playlist: 1800e3 }
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
async function recommendWhyMusic(mode = 'hot', limit = 40) {
  const listIds = GD_TOPLISTS[mode] || GD_TOPLISTS.hot
  const seen = new Set()
  const out = []
  const errors = []
  for (const listId of listIds) {
    if (out.length >= limit) break
    let tracks = []
    try {
      const data = await gdRequest('playlist', { source: 'netease', id: listId })
      tracks = sortTracksByMode(data?.playlist?.tracks || [], mode)
    } catch (err) {
      console.error(`[gd] playlist ${listId} failed: ${err.message}`)
      errors.push(`${listId}（${err.message}）`)
      continue
    }
    for (const track of tracks) {
      if (out.length >= limit) break
      const title = String(track.name || '')
      if (!track.id || !title) continue
      const album = track.al || track.album || {}
      const artist = (track.ar || track.artists || [])
        .map(a => a.name).filter(Boolean).join(' / ')
      const key = `${gdNormalizeName(title)}::${gdNormalizeName(artist)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: String(track.id),
        title,
        artist,
        album: String(album.name || ''),
        artwork: album.picUrl || '',
        platform: 'WhyMusic',
        subSource: 'netease',
        picId: album.pic_str || (album.pic != null ? String(album.pic) : ''),
        lyricId: String(track.id),
        duration: track.dt ? Math.round(track.dt / 1000) : 0,
        type: 'music',
      })
    }
  }
  // 同上：榜單全取不到就要拋錯，別讓推薦頁靜靜地空著
  if (out.length === 0 && errors.length > 0) {
    throw new Error(`榜單全部取不到：${errors.join('；')}`)
  }
  return out
}


export {
  searchWhyMusic,
  resolveWhyMusicUrl,
  getWhyMusicLyric,
  getWhyMusicPic,
  recommendWhyMusic,
  audiomackContainerToWhyItem,
  searchAudiomack,
  getAudiomackAlbumOrSheet,
  GD_BITRATE,
}
