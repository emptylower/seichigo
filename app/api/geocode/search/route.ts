import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { createGeocodeSearchHandlers } from '@/lib/share/handlers/geocodeSearch'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    return await createGeocodeSearchHandlers({ getSession: getServerAuthSession }).GET(req)
  } catch (err) {
    console.error('[api/geocode/search] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
