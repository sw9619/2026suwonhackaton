import { Router, Request, Response } from 'express'

const router = Router()

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface KakaoDoc {
  place_name: string
  address_name: string
  road_address_name: string
  category_group_name: string
  category_name: string
  phone: string
  x: string
  y: string
}

router.get('/search', async (req: Request, res: Response) => {
  const { q, lat, lng } = req.query as { q?: string; lat?: string; lng?: string }
  if (!q?.trim()) return res.json({ places: [] })

  const userLat = lat ? parseFloat(lat) : null
  const userLng = lng ? parseFloat(lng) : null
  const hasUserPos = userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng)

  const kakaoKey = (process.env.KAKAO_REST_KEY ?? 'beba33e1efaee632aeebdad1bf4e5e6a').trim()

  try {
    const fetchPage = async (page: number) => {
      let url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q!)}&size=15&page=${page}`
      if (hasUserPos) url += `&x=${userLng}&y=${userLat}&sort=distance`
      const resp = await fetch(url, { headers: { Authorization: `KakaoAK ${kakaoKey}` } })
      if (!resp.ok) throw new Error(`Kakao API error: ${resp.status}`)
      const data = await resp.json() as { documents: KakaoDoc[]; meta: { total_count: number; is_end: boolean } }
      return data
    }

    const page1 = await fetchPage(1)
    let docs: KakaoDoc[] = [...page1.documents]

    // 결과가 15개 이상이고 2페이지 있으면 추가 로드
    if (!page1.meta.is_end && page1.meta.total_count > 15) {
      try {
        const page2 = await fetchPage(2)
        docs = [...docs, ...page2.documents]
      } catch {
        // 2페이지 실패해도 1페이지 결과 사용
      }
    }

    const places = docs.map(d => {
      const placeLat = parseFloat(d.y)
      const placeLng = parseFloat(d.x)
      const distance = hasUserPos ? distKm(userLat!, userLng!, placeLat, placeLng) : undefined
      // category_name 마지막 세그먼트만 표시 (ex. "음식점 > 한식 > 국밥" → "국밥")
      const categoryDetail = d.category_name?.split(' > ').pop() ?? d.category_group_name ?? undefined
      return {
        name: d.place_name,
        address: d.road_address_name || d.address_name,
        category: d.category_group_name || categoryDetail || undefined,
        categoryDetail,
        phone: d.phone || undefined,
        lat: placeLat,
        lng: placeLng,
        distance,
      }
    })

    if (hasUserPos) places.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))

    return res.json({ places })
  } catch (e) {
    console.error('[GET /places/search]', e)
    return res.json({ places: [] })
  }
})

export default router
