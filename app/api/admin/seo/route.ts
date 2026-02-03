export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  const session = await getServerAuthSession()
  
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const keywords = await prisma.seoKeyword.findMany({
      include: {
        rankHistory: {
          orderBy: { checkedAt: 'desc' },
          take: 5
        }
      }
    })
    
    return NextResponse.json({ keywords })
  } catch (error) {
    console.error('[api/admin/seo] GET failed', error)
    return NextResponse.json(
      { error: 'Failed to fetch data' },
      { status: 500 }
    )
  }
}
