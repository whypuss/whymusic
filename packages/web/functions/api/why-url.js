/**
 * /api/why-url — 取播放 URL（Cloudflare Pages Function）
 * 帶 title/artist 時，指定子源拿不到會跨子源找同一首歌。
 */
import { resolveWhyMusicUrl, GD_BITRATE, jsonResponse } from '../_lib/why.js'

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const songId = url.searchParams.get('id') || ''
  const source = url.searchParams.get('source') || ''
  const bitrate = parseInt(url.searchParams.get('br') || String(GD_BITRATE), 10)
  const title = url.searchParams.get('title') || ''
  const artist = url.searchParams.get('artist') || ''
  if (!songId && !title) return jsonResponse({ error: 'Missing id or title parameter' }, 400)
  try {
    const resolved = await resolveWhyMusicUrl({ id: songId, source, bitrate, title, artist })
    if (!resolved) return jsonResponse({ error: 'No media URL returned' }, 404)
    return jsonResponse(resolved)
  } catch (err) {
    console.error('[why-url]', err.message)
    return jsonResponse({ error: err.message }, 500)
  }
}
