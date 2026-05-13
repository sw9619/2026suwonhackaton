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

router.get('/search', async (req: Request, res: Response) => {
  const { q, lat, lng } = req.query as { q?: string; lat?: string; lng?: string }
  if (!q?.trim()) return res.json({ places: [] })

  const userLat = lat ? parseFloat(lat) : null
  const userLng = lng ? parseFloat(lng) : null
  const hasUserPos = userLat !== null && userLng !== null && !isNaN(userLat) && !isNaN(userLng)

  const kakaoKey = process.env.KAKAO_REST_KEY?.trim()

  try {
    if (kakaoKey) {
      let url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=15`
      if (hasUserPos) url += `&x=${userLng}&y=${userLat}&sort=distance`

      const resp = await fetch(url, { headers: { Authorization: `KakaoAK ${kakaoKey}` } })
      if (!resp.ok) throw new Error(`Kakao API error: ${resp.status}`)
      const data = await resp.json() as {
        documents: {
          place_name: string
          address_name: string
          road_address_name: string
          category_group_name: string
          x: string
          y: string
        }[]
      }

      const places = (data.documents ?? []).map(d => {
        const placeLat = parseFloat(d.y)
        const placeLng = parseFloat(d.x)
        const distance = hasUserPos ? distKm(userLat!, userLng!, placeLat, placeLng) : undefined
        return {
          name: d.place_name,
          address: d.road_address_name || d.address_name,
          category: d.category_group_name || undefined,
          lat: placeLat,
          lng: placeLng,
          distance,
        }
      })

      if (hasUserPos) places.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))

      return res.json({ places })
    } else {
      // Nominatim fallback: 검색어 그대로 사용 (수원 강제 추가 제거)
      const fetchNominatim = async (query: string) => {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=20&countrycodes=kr&accept-language=ko&addressdetails=1&namedetails=1`
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'SuwonSignal/1.0 (hackathon@suwon.ac.kr)' },
        })
        if (!resp.ok) throw new Error(`Nominatim error: ${resp.status}`)
        return resp.json() as Promise<{
          name: string; display_name: string; type: string; class: string; lat: string; lon: string
        }[]>
      }

      // 먼저 원래 쿼리로 검색, 결과 없으면 "수원 + 쿼리"로 재시도
      let data = await fetchNominatim(q!)
      if (data.length === 0) {
        data = await fetchNominatim(`수원 ${q}`)
      }

      const places = data
        .filter(d => d.name && d.class !== 'boundary')
        .map(d => {
          const placeLat = parseFloat(d.lat)
          const placeLng = parseFloat(d.lon)
          const parts = d.display_name.split(', ')
          const addrParts = parts.slice(1).filter(p =>
            !p.match(/^\d+/) && p !== '대한민국' && p.length < 30
          ).slice(0, 3)
          const distance = hasUserPos ? distKm(userLat!, userLng!, placeLat, placeLng) : undefined
          return {
            name: d.name || parts[0],
            address: addrParts.join(' '),
            category: d.type,
            lat: placeLat,
            lng: placeLng,
            distance,
          }
        })
        .filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i)

      if (hasUserPos) places.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))

      return res.json({ places: places.slice(0, 15) })
    }
  } catch (e) {
    console.error('[GET /places/search]', e)
    return res.json({ places: [] })
  }
})

export default router
