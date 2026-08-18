/** /api/why-lyric — 歌詞（Cloudflare Pages Function） */
import { getWhyMusicLyric, jsonResponse } from '../_lib/why.js'

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const source = url.searchParams.get('source') || ''
  if (!id) return jsonResponse({ error: 'Missing id parameter' }, 400)
  try {
    return jsonResponse(await getWhyMusicLyric(id, source))
  } catch (err) {
    return jsonResponse({ error: err.message }, 500)
  }
}
