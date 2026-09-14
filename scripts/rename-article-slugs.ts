#!/usr/bin/env tsx
import { prisma } from '@/lib/db/prisma'
import { LEGACY_POST_SLUGS } from '@/lib/posts/legacySlugs'

const APPLY = process.argv.includes('--apply')

type RenameRow = {
  id: string
  language: string
  title: string
  oldSlug: string
  newSlug: string
}

async function main(): Promise<void> {
  console.log(`[${new Date().toISOString()}] rename-article-slugs`)
  console.log(`Mode: ${APPLY ? 'APPLY (写入数据库)' : 'DRY RUN (默认，不写库；加 --apply 才写)'}`)
  console.log('')

  const updates: RenameRow[] = []

  for (const [oldSlug, newSlug] of Object.entries(LEGACY_POST_SLUGS)) {
    console.log(`=== ${oldSlug}`)
    console.log(`  → ${newSlug}`)

    const rows = await prisma.article.findMany({
      where: { slug: oldSlug },
      select: { id: true, language: true, title: true },
      orderBy: { language: 'asc' },
    })
    if (rows.length === 0) {
      console.log('  (no rows found with this slug)')
    }
    for (const row of rows) {
      console.log(`  id=${row.id} language=${row.language} title=${row.title}`)
      updates.push({ id: row.id, language: row.language, title: row.title, oldSlug, newSlug })
    }

    const conflicts = await prisma.article.findMany({
      where: { slug: newSlug },
      select: { id: true, language: true, slug: true },
    })
    if (conflicts.length > 0) {
      throw new Error(
        `目标 slug "${newSlug}" 已存在 ${conflicts.length} 行（${conflicts
          .map((c) => `${c.id}/${c.language}`)
          .join(', ')}），为避免破坏唯一约束直接退出，未写任何数据`
      )
    }
  }

  console.log('')
  if (!APPLY) {
    console.log(`DRY RUN, nothing written (${updates.length} row(s) would be renamed)`)
    console.log('确认无误后，运行: npx tsx scripts/rename-article-slugs.ts --apply')
    return
  }

  if (updates.length === 0) {
    console.log('没有需要重命名的行，未写库')
    return
  }

  await prisma.$transaction(
    updates.map((u) => prisma.article.update({ where: { id: u.id }, data: { slug: u.newSlug } }))
  )
  console.log(`✅ 已在事务中重命名 ${updates.length} 行`)

  for (const newSlug of new Set(Object.values(LEGACY_POST_SLUGS))) {
    const rows = await prisma.article.findMany({
      where: { slug: newSlug },
      select: { id: true, language: true },
      orderBy: { language: 'asc' },
    })
    console.log(`verify ${newSlug}: ${rows.length} row(s) [${rows.map((r) => r.language).join(', ')}]`)
  }
}

main()
  .catch((err) => {
    console.error('❌ Script failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
