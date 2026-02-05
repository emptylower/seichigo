export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { checkKeywordRank } from '@/lib/seo/serp/check'

export async function POST(request: Request) {
  const session = await getServerAuthSession()
  
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { keywordId } = await request.json()
    
    if (!keywordId) {
      return NextResponse.json(
        { error: 'keywordId is required' },
        { status: 400 }
      )
    }
    
    const keyword = await prisma.seoKeyword.findUnique({
      where: { id: keywordId }
    })
    
    if (!keyword) {
      return NextResponse.json(
        { error: 'Keyword not found' },
        { status: 404 }
      )
    }
    
    const result = await checkKeywordRank(keyword.keyword, keyword.language, { keywordId: keyword.id })
    
    return NextResponse.json({
      message: result.position 
        ? `Found at position #${result.position}` 
        : 'Not found in top 100',
      result
    })
  } catch (error) {
    console.error('[api/admin/seo/rank] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    )
  }
}
