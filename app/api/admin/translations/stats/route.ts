import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import {
  getTranslationTaskStatsForAdmin,
  parseTranslationTaskStatsFilter,
} from '@/lib/translation/adminDashboard'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const filter = parseTranslationTaskStatsFilter({
      entityType: searchParams.get('entityType'),
      targetLanguage: searchParams.get('targetLanguage'),
    })

    const counts = await getTranslationTaskStatsForAdmin(filter)
    return NextResponse.json({ ok: true, counts })
  } catch (error) {
    console.error('[api/admin/translations/stats] GET failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
