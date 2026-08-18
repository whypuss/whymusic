/** /api/why-pic — 封面（Cloudflare Pages Function） */
import { getWhyMusicPic, jsonResponse } from '../_lib/why.js'

export async function onRequest({ request }) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const source = url.searchParams.get('source') || ''
  const size = parseInt(url.searchParams.get('size') || '500', 10)
  if (!id) return jsonResponse({ error: 'Missing id parameter' }, 400)
  try {
    return jsonResponse({ url: await getWhyMusicPic(id, source, size) })
  } catch (err) {
    return jsonResponse({ error: err.message }, 500)
  }
}
