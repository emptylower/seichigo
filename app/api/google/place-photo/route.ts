import { getGooglePlacesApiDeps } from '@/lib/googlePlaces/api'
import { createPlacePhotoHandlers } from '@/lib/googlePlaces/handlers/placePhoto'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const deps = await getGooglePlacesApiDeps()
    return await createPlacePhotoHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/google/place-photo] GET failed', err)
    return Response.json({ error: '服务器错误' }, { status: 500 })
  }
}
