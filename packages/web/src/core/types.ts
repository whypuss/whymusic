/**
 * 搜索類型
 */
export type SearchType = 'music' | 'album' | 'sheet' | 'artist'

/**
 * 歌曲信息
 */
export interface MusicItem {
  id: string
  platform: string
  title: string
  artist: string
  artwork?: string
  album?: string
  /** 歌曲 URL（如果插件直接返回） */
  url?: string
  /** 搜索質量 */
  quality?: string
  /** 歌手名的別名。不同音源用的欄位名不一致，兩種都收 */
  artistName?: string
  /** 封面圖的別名。同上 */
  cover?: string
  /** 歌曲 ID 的別名。同上 */
  songmid?: string
  /** 項目類型：歌曲 / 專輯 / 歌單 / 歌手 */
  type?: 'music' | 'album' | 'sheet' | 'artist'
  /** 專輯/歌單 URL slug */
  url_slug?: string
  /** 專輯/歌單內的歌曲列表（專輯/歌單詳情） */
  musicList?: MusicItem[]
  /** 後端返回的音頻時長 */
  duration?: number
  /** 聚合音源的子音源（netease / joox…），取音源時需原樣帶回 */
  subSource?: string
  /**
   * 已知播不出來的子音源。播放器實際播失敗時填入，音源解析時會跳過它們。
   * 伺服器端只看得到「解析失敗」，URL 解析成功但客戶端播不出來
   * （CDN 對該地區回 403、容器格式不支援…）只有前端知道。
   */
  _exclude?: string[]
  /** GD 聚合音源的封面 ID（供 /api/why-pic 解析） */
  picId?: string
  /** GD 聚合音源的歌詞 ID（供 /api/why-lyric 解析） */
  lyricId?: string
  /** 內部 fallback 標記（避免重複嘗試） */
  _gdFallbackAttempted?: boolean
  /** 內部 fallback 標記（避免重複嘗試下載 fallback） */
  _dlFallbackAttempted?: boolean
  /** 專輯詳情 context（供播放失敗自動跳下一首） */
  _albumDetail?: MusicItem
  /** 專輯內 track 索引 */
  _trackIndex?: number
}

/**
 * 搜尋結果
 */
export interface SearchResults {
  data: MusicItem[]
  isEnd?: boolean
  hasMore?: boolean
}

/**
 * 音源信息
 */
export interface MediaSource {
  url: string
  quality?: string
  headers?: Record<string, string>
  userAgent?: string
}

/**
 * 插件定義。module.exports 出這些方法就是一個音源。
 */
export interface Plugin {
  platform: string
  name: string
  version: string
  description?: string
  author?: string
  userVariables?: any[]
  cacheControl?: string
  instance?: any
  supportedMethods?: Set<string>
  /** 搜尋歌曲，回 { data, isEnd } */
  search?(query: string, page?: number, type?: SearchType): Promise<SearchResults>
  /** 獲取音源 URL */
  getMediaSource?(item: MusicItem, quality?: string): Promise<MediaSource>
  /** 獲取歌曲詳情 */
  getMusicInfo?(item: MusicItem): Promise<any>
  /** 獲取歌詞 */
  getLyric?(item: MusicItem): Promise<any>
  /** 獲取專輯信息 */
  getAlbumInfo?(item: any, page?: number): Promise<any>
  /** 獲取歌手信息 */
  getArtistInfo?(item: any, page?: number, type?: string): Promise<any>
  /** 獲取歌單信息 */
  getMusicSheetInfo?(item: any, page?: number): Promise<any>
}