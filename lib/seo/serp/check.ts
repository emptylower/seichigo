import { prisma } from '@/lib/db/prisma'
import { searchGoogle } from './client'
import { checkQuota, incrementQuota } from './quota'

export async function checkKeywordRank(keyword: string, lang: string, domain: string = 'seichigo.com') {
  const quota = await checkQuota()
  if (!quota.allowed) {
    throw new Error(`SerpApi quota exceeded: ${quota.used}/${quota.limit} this month`)
  }
  
  const results = await searchGoogle(keyword, lang)
  
  const rank = results.findIndex(r => r.link && r.link.includes(domain))
  const position = rank >= 0 ? rank + 1 : null
  const url = rank >= 0 ? results[rank].link : null
  
  await incrementQuota()
  
  const keywordRecord = await prisma.seoKeyword.findFirst({
    where: { keyword, language: lang }
  })
  
  if (keywordRecord) {
    await prisma.seoRankHistory.create({
      data: {
        keywordId: keywordRecord.id,
        position,
        url,
        source: 'serpapi'
      }
    })
  }
  
  return { keyword, position, url, quota: { used: quota.used + 1, limit: quota.limit } }
}
