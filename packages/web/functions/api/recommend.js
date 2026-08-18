/** /api/recommend — 推薦（香港叱咤903榜，Cloudflare Pages Function） */
import { recommendWhyMusic, jsonResponse } from '../_lib/why.js'

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') || 'hot'
  const limit = parseInt(url.searchParams.get('limit') || '40', 10)
  try {
    return jsonResponse({ mode, data: await recommendWhyMusic(mode, limit) })
  } catch (err) {
    console.error('[recommend]', err.message)
    return jsonResponse({ error: err.message }, 500)
  }
}
