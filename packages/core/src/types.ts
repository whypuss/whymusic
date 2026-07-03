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
  /** MusicFree 原生：歌手名（兼容） */
  artistName?: string
  /** MusicFree 原生：封面圖（兼容） */
  cover?: string
  /** MusicFree 原生：歌曲 ID（兼容） */
  songmid?: string
}

/**
 * 搜索結果（MusicFree 原生格式）
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
 * 插件定義（MusicFree 原生格式）
 * search 返回 SearchResults（與 MusicFree 原生一致）
 */
export interface Plugin {
  platform: string
  name: string
  version: string
  description?: string
  author?: string
  instance?: any
  /** 搜索歌曲（返回 MusicFree 原生格式 {data, isEnd}） */
  search(query: string, page?: number, type?: SearchType): Promise<SearchResults>
  /** 獲取音源 URL */
  getMediaSource(item: MusicItem, quality?: string): Promise<MediaSource>
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