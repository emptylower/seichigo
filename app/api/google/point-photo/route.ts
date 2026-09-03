import { getGooglePointPhotoDeps } from '@/lib/googlePlaces/api'
import { createPointPhotoHandlers } from '@/lib/googlePlaces/handlers/pointPhoto'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const deps = await getGooglePointPhotoDeps()
    return await createPointPhotoHandlers(deps).GET(req)
  } catch (err) {
    console.error('[api/google/point-photo] GET failed', err)
    return Response.json({ error: '服务器错误' }, { status: 500 })
  }
}
