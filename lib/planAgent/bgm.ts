import type { BgmSubject } from './points'

const BGM_UA = 'seichigo/1.0 (https://seichigo.com)'

export async function searchBgmSubjects(keyword: string, limit = 5): Promise<BgmSubject[]> {
  const url = `https://api.bgm.tv/search/subject/${encodeURIComponent(keyword)}?type=2&responseGroup=small&max_results=${limit}`
  const res = await fetch(url, { headers: { 'User-Agent': BGM_UA } })
  if (!res.ok) return []
  const body = (await res.json().catch(() => null)) as {
    list?: Array<{ id?: number; name?: string; name_cn?: string }>
  } | null
  if (!body?.list) return []
  return body.list
    .filter((s) => typeof s.id === 'number')
    .map((s) => ({ id: s.id as number, name: s.name ?? '', nameCn: s.name_cn ?? '' }))
}
