#!/usr/bin/env tsx
import { prisma } from '@/lib/db/prisma'

const SLUG = '你的名字-your-name-tokyo-from-hida-to-suwa'
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`[${new Date().toISOString()}] Starting full article repair...`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be applied)' : 'LIVE (changes will be applied)'}`)
  console.log(`Target slug: ${SLUG}`)
  console.log('')

  // Find Chinese article with ALL fields
  const zhArticle = await prisma.article.findUnique({
    where: { slug_language: { slug: SLUG, language: 'zh' } },
    select: {
      id: true,
      translationGroupId: true,
      title: true,
      seoTitle: true,
      description: true,
      cover: true,
      contentJson: true,
      contentHtml: true,
      animeIds: true,
      city: true,
      routeLength: true,
      tags: true
    }
  })

  if (!zhArticle) {
    console.error('❌ Chinese article not found')
    process.exit(1)
  }

  console.log(`✓ Found Chinese article:`)
  console.log(`  ID: ${zhArticle.id}`)
  console.log(`  Title: ${zhArticle.title}`)
  console.log(`  translationGroupId: ${zhArticle.translationGroupId || 'null'}`)
  console.log(`  cover: ${zhArticle.cover || 'null'}`)
  console.log(`  contentJson: ${zhArticle.contentJson ? 'present' : 'null'}`)
  console.log(`  contentHtml: ${zhArticle.contentHtml ? `${zhArticle.contentHtml.length} chars` : 'empty'}`)
  console.log(`  animeIds: [${zhArticle.animeIds.join(', ')}]`)
  console.log(`  city: ${zhArticle.city || 'null'}`)
  console.log(`  routeLength: ${zhArticle.routeLength || 'null'}`)
  console.log(`  tags: [${zhArticle.tags.join(', ')}]`)
  console.log('')

  // Find English article with ALL fields
  const enArticle = await prisma.article.findUnique({
    where: { slug_language: { slug: SLUG, language: 'en' } },
    select: {
      id: true,
      translationGroupId: true,
      title: true,
      seoTitle: true,
      description: true,
      cover: true,
      contentJson: true,
      contentHtml: true,
      animeIds: true,
      city: true,
      routeLength: true,
      tags: true
    }
  })

  if (!enArticle) {
    console.log('⚠️  English article not found (no translation exists yet)')
    console.log('')
    
    // Only repair Chinese article if needed
    if (!zhArticle.translationGroupId) {
      console.log('📝 Repair needed for Chinese article:')
      console.log(`  - Set translationGroupId: null → ${zhArticle.id}`)
      
      if (!DRY_RUN) {
        await prisma.article.update({
          where: { id: zhArticle.id },
          data: { translationGroupId: zhArticle.id }
        })
        console.log('✅ Chinese article repaired')
      } else {
        console.log('🔍 DRY RUN: Would repair Chinese article')
      }
    } else {
      console.log('✓ Chinese article already has correct translationGroupId')
    }
    
    console.log('')
    console.log('Repair complete')
    return
  }

  console.log(`✓ Found English article:`)
  console.log(`  ID: ${enArticle.id}`)
  console.log(`  Title: ${enArticle.title}`)
  console.log(`  translationGroupId: ${enArticle.translationGroupId || 'null'}`)
  console.log(`  cover: ${enArticle.cover || 'null'}`)
  console.log(`  contentJson: ${enArticle.contentJson ? 'present' : 'null'}`)
  console.log(`  contentHtml: ${enArticle.contentHtml ? `${enArticle.contentHtml.length} chars` : 'empty'}`)
  console.log(`  animeIds: [${enArticle.animeIds.join(', ')}]`)
  console.log(`  city: ${enArticle.city || 'null'}`)
  console.log(`  routeLength: ${enArticle.routeLength || 'null'}`)
  console.log(`  tags: [${enArticle.tags.join(', ')}]`)
  console.log('')

  // Check what repairs are needed
  const repairs: Array<{ article: 'zh' | 'en', field: string, from: string, to: string }> = []

  // Check Chinese article translationGroupId
  if (!zhArticle.translationGroupId) {
    repairs.push({
      article: 'zh',
      field: 'translationGroupId',
      from: 'null',
      to: zhArticle.id
    })
  } else if (zhArticle.translationGroupId !== zhArticle.id) {
    repairs.push({
      article: 'zh',
      field: 'translationGroupId',
      from: zhArticle.translationGroupId,
      to: zhArticle.id
    })
  }

  // Check English article translationGroupId
  if (!enArticle.translationGroupId) {
    repairs.push({
      article: 'en',
      field: 'translationGroupId',
      from: 'null',
      to: zhArticle.id
    })
  } else if (enArticle.translationGroupId !== zhArticle.id) {
    repairs.push({
      article: 'en',
      field: 'translationGroupId',
      from: enArticle.translationGroupId,
      to: zhArticle.id
    })
  }

  // Check English article cover
  if (!enArticle.cover && zhArticle.cover) {
    repairs.push({
      article: 'en',
      field: 'cover',
      from: 'null',
      to: zhArticle.cover
    })
  }

  // Check English article contentJson
  if (!enArticle.contentJson && zhArticle.contentJson) {
    repairs.push({
      article: 'en',
      field: 'contentJson',
      from: 'null',
      to: 'copied from zh'
    })
  }

  // Check English article contentHtml
  if (!enArticle.contentHtml && zhArticle.contentHtml) {
    repairs.push({
      article: 'en',
      field: 'contentHtml',
      from: 'empty',
      to: `${zhArticle.contentHtml.length} chars`
    })
  }

  // Check English article animeIds
  if (enArticle.animeIds.length === 0 && zhArticle.animeIds.length > 0) {
    repairs.push({
      article: 'en',
      field: 'animeIds',
      from: '[]',
      to: `[${zhArticle.animeIds.join(', ')}]`
    })
  }

  // Check English article city
  if (!enArticle.city && zhArticle.city) {
    repairs.push({
      article: 'en',
      field: 'city',
      from: 'null',
      to: zhArticle.city
    })
  }

  // Check English article routeLength
  if (!enArticle.routeLength && zhArticle.routeLength) {
    repairs.push({
      article: 'en',
      field: 'routeLength',
      from: 'null',
      to: zhArticle.routeLength
    })
  }

  // Check English article tags
  if (enArticle.tags.length === 0 && zhArticle.tags.length > 0) {
    repairs.push({
      article: 'en',
      field: 'tags',
      from: '[]',
      to: `[${zhArticle.tags.join(', ')}]`
    })
  }

  if (repairs.length === 0) {
    console.log('✓ No repairs needed - all data is correct')
    console.log('')
    console.log('Repair complete')
    return
  }

  console.log('📝 Repairs needed:')
  repairs.forEach((repair, idx) => {
    console.log(`  ${idx + 1}. ${repair.article.toUpperCase()} article - ${repair.field}:`)
    console.log(`     ${repair.from} → ${repair.to}`)
  })
  console.log('')

  if (DRY_RUN) {
    console.log('🔍 DRY RUN: No changes applied')
    console.log('Run without --dry-run to apply these repairs')
  } else {
    console.log('Applying repairs...')
    
    // Apply Chinese article repairs
    const zhRepairs = repairs.filter(r => r.article === 'zh')
    if (zhRepairs.length > 0) {
      const zhData: Record<string, any> = {}
      zhRepairs.forEach(r => {
        if (r.field === 'translationGroupId') {
          zhData[r.field] = r.to
        }
      })
      
      await prisma.article.update({
        where: { id: zhArticle.id },
        data: zhData
      })
      console.log(`✅ Chinese article updated (${zhRepairs.length} field${zhRepairs.length > 1 ? 's' : ''})`)
    }

    // Apply English article repairs
    const enRepairs = repairs.filter(r => r.article === 'en')
    if (enRepairs.length > 0) {
      const enData: Record<string, any> = {}
      enRepairs.forEach(r => {
        if (r.field === 'translationGroupId') {
          enData[r.field] = r.to
        } else if (r.field === 'cover') {
          enData[r.field] = zhArticle.cover
        } else if (r.field === 'contentJson') {
          enData[r.field] = zhArticle.contentJson
        } else if (r.field === 'contentHtml') {
          enData[r.field] = zhArticle.contentHtml
        } else if (r.field === 'animeIds') {
          enData[r.field] = zhArticle.animeIds
        } else if (r.field === 'city') {
          enData[r.field] = zhArticle.city
        } else if (r.field === 'routeLength') {
          enData[r.field] = zhArticle.routeLength
        } else if (r.field === 'tags') {
          enData[r.field] = zhArticle.tags
        }
      })
      
      await prisma.article.update({
        where: { id: enArticle.id },
        data: enData
      })
      console.log(`✅ English article updated (${enRepairs.length} field${enRepairs.length > 1 ? 's' : ''})`)
    }

    console.log('')
    console.log('✅ All repairs applied successfully')
  }

  console.log('')
  console.log('Repair complete')
}

main()
  .catch((err) => {
    console.error('❌ Script failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
