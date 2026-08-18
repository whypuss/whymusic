/**
 * /api/album — 專輯曲目（Cloudflare Pages Function）
 * 曲目改掛 WhyMusic，播放時才會走聚合分支、享有跨子源救援。
 */
import { getAudiomackAlbumOrSheet, jsonResponse } from '../_lib/why.js'

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const slug = url.searchParams.get('slug')
  const artist = url.searchParams.get('artist')
  if (!id || !slug || !artist) {
    return jsonResponse({ error: 'Missing id, slug, or artist parameter' }, 400)
  }
  try {
    const tracks = await getAudiomackAlbumOrSheet(id, slug, artist)
    return jsonResponse(Array.isArray(tracks)
      ? tracks.map(t => ({ ...t, platform: 'WhyMusic', subSource: 'audiomack' }))
      : tracks)
  } catch (err) {
    return jsonResponse({ error: err.message }, 500)
  }
}
