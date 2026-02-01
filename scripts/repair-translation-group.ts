#!/usr/bin/env tsx
import { prisma } from '@/lib/db/prisma'

const SLUG = '你的名字-your-name-tokyo-from-hida-to-suwa'
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`[${new Date().toISOString()}] Starting repair script...`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be applied)' : 'LIVE (changes will be applied)'}`)
  console.log(`Target slug: ${SLUG}`)
  console.log('')

  // Find Chinese article
  const zhArticle = await prisma.article.findUnique({
    where: { slug_language: { slug: SLUG, language: 'zh' } },
    select: { id: true, translationGroupId: true, cover: true, title: true }
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
  console.log('')

  // Find English article
  const enArticle = await prisma.article.findUnique({
    where: { slug_language: { slug: SLUG, language: 'en' } },
    select: { id: true, translationGroupId: true, cover: true, title: true }
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
  console.log('')

  // Check what repairs are needed
  const repairs: Array<{ article: 'zh' | 'en', field: string, from: string | null, to: string | null }> = []

  // Check Chinese article translationGroupId
  if (!zhArticle.translationGroupId) {
    repairs.push({
      article: 'zh',
      field: 'translationGroupId',
      from: null,
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
      from: null,
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
      from: null,
      to: zhArticle.cover
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
    console.log(`     ${repair.from || 'null'} → ${repair.to}`)
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
      const zhData: Record<string, string> = {}
      zhRepairs.forEach(r => {
        if (r.to) zhData[r.field] = r.to
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
      const enData: Record<string, string> = {}
      enRepairs.forEach(r => {
        if (r.to) enData[r.field] = r.to
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
