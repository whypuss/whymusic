/**
 * /api/why-search — WhyMusic 聚合搜尋（Cloudflare Pages Function）
 * 歌曲走三子源聚合；專輯／歌單／歌手僅 audiomack 子源提供。
 */
import {
  searchWhyMusic, searchAudiomack, audiomackContainerToWhyItem, jsonResponse,
} from '../_lib/why.js'

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const keyword = url.searchParams.get('q')
  const type = url.searchParams.get('type') || 'music'
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const count = parseInt(url.searchParams.get('count') || '20', 10)
  if (!keyword) return jsonResponse({ error: 'Missing q parameter' }, 400)
  try {
    const results = type === 'music'
      ? await searchWhyMusic(keyword, page, count)
      : (await searchAudiomack(keyword, type, page)).map(audiomackContainerToWhyItem)
    return jsonResponse({ data: results })
  } catch (err) {
    console.error('[why-search]', err.message)
    return jsonResponse({ error: err.message }, 500)
  }
}
