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
}

/**
 * 搜索結果
 */
export interface SearchResults {
  data: MusicItem[]
  /** 是否有更多 */
  hasMore?: boolean
}

/**
 * 音源信息
 */
export interface MediaSource {
  url: string
  quality?: string
}

/**
 * 插件定義
 */
export interface Plugin {
  platform: string
  name: string
  version: string
  /** 搜索歌曲 */
  search(query: string, page?: number, type?: string): Promise<SearchResults>
  /** 獲取音源 URL */
  getMediaSource(item: MusicItem, quality?: string): Promise<MediaSource>
}
