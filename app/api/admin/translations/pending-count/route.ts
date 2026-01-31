import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const count = await prisma.translationTask.count({
      where: { status: 'ready' },
    })

    return NextResponse.json({ count })
  } catch (error) {
    console.error('[api/admin/translations/pending-count] GET failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
