#!/usr/bin/env tsx
import { prisma } from '@/lib/db/prisma'

const APPLY = process.argv.includes('--apply')

const SHINJUKU_SLUG = '你的名字-your-name-seichigo-tokyo-shinjuku'
const SHINJUKU_SEO_TITLE =
  '『君の名は。』東京聖地巡礼 新宿編｜新宿駅→須賀神社 半日モデルコース（地図・撮影スポット付き）'
const SHINJUKU_DESCRIPTION_OLD_PREFIX = '『君の名は。』東京都新宿区 聖地巡礼 半日コースまとめ：'
const SHINJUKU_DESCRIPTION_NEW_PREFIX = '『君の名は。』新宿の聖地を半日で全部回るモデルコース。'

const MINATO_SLUG = '你的名字-your-name-tokyo-minato-ward'
const MINATO_DESCRIPTION =
  '『君の名は。』港区・恵比寿エリアの聖地を1日で回る実践ルート。国立新美術館、六本木ヒルズ、恵比寿ガーデンプレイス、渋谷スクランブル交差点から東京駅まで、各ロケ地の作中カット再現ポイントと回り方を解説。新宿編と合わせて東京の聖地を網羅。'

type JaArticle = {
  id: string
  slug: string
  title: string
  seoTitle: string | null
  description: string | null
}

async function loadArticle(slug: string): Promise<JaArticle | null> {
  return prisma.article.findUnique({
    where: { slug_language: { slug, language: 'ja' } },
    select: { id: true, slug: true, title: true, seoTitle: true, description: true },
  })
}

function printField(label: string, before: string | null, after: string): void {
  console.log(`  ${label}:`)
  console.log(`    before: ${before ?? '(null)'}`)
  console.log(`    after:  ${after}`)
}

async function updateShinjuku(): Promise<void> {
  console.log(`=== ${SHINJUKU_SLUG} (ja) ===`)
  const article = await loadArticle(SHINJUKU_SLUG)
  if (!article) {
    console.error('❌ Japanese article not found')
    return
  }

  const titleTargetField = article.seoTitle ? 'seoTitle' : 'title'
  console.log(`✓ Found article (id: ${article.id})`)
  console.log(`ℹ️  <title> source column: ${titleTargetField}${article.seoTitle ? '' : ' (seoTitle 为空，title 承担 <title>)'}`)
  printField(titleTargetField, article[titleTargetField], SHINJUKU_SEO_TITLE)

  let newDescription: string | null = null
  if (article.description && article.description.startsWith(SHINJUKU_DESCRIPTION_OLD_PREFIX)) {
    newDescription =
      SHINJUKU_DESCRIPTION_NEW_PREFIX + article.description.slice(SHINJUKU_DESCRIPTION_OLD_PREFIX.length)
    printField('description', article.description, newDescription)
  } else if (article.description && article.description.startsWith(SHINJUKU_DESCRIPTION_NEW_PREFIX)) {
    console.log('✓ description 已是目标前缀，跳过')
  } else {
    console.log('⚠️  description 未找到预期前缀，跳过该字段（请人工确认后再改脚本）')
    console.log(`    expected prefix: ${SHINJUKU_DESCRIPTION_OLD_PREFIX}`)
    console.log(`    actual:          ${article.description ?? '(null)'}`)
  }

  if (!APPLY) {
    console.log('🔍 DRY RUN: 未写库\n')
    return
  }

  await prisma.article.update({
    where: { id: article.id },
    data: {
      [titleTargetField]: SHINJUKU_SEO_TITLE,
      ...(newDescription !== null ? { description: newDescription } : {}),
    },
  })
  console.log('✅ 已写库\n')
}

async function updateMinato(): Promise<void> {
  console.log(`=== ${MINATO_SLUG} (ja) ===`)
  const article = await loadArticle(MINATO_SLUG)
  if (!article) {
    console.error('❌ Japanese article not found')
    return
  }

  console.log(`✓ Found article (id: ${article.id})`)
  console.log('  seoTitle: 不动')
  printField('description', article.description, MINATO_DESCRIPTION)

  if (!APPLY) {
    console.log('🔍 DRY RUN: 未写库\n')
    return
  }

  await prisma.article.update({
    where: { id: article.id },
    data: { description: MINATO_DESCRIPTION },
  })
  console.log('✅ 已写库\n')
}

async function main() {
  console.log(`[${new Date().toISOString()}] update-ja-article-seo`)
  console.log(`Mode: ${APPLY ? 'APPLY (写入数据库)' : 'DRY RUN (默认，不写库；加 --apply 才写)'}`)
  console.log('')

  await updateShinjuku()
  await updateMinato()

  if (!APPLY) {
    console.log('确认以上 before/after 无误后，运行: npx tsx scripts/update-ja-article-seo.ts --apply')
  }
}

main()
  .catch((err) => {
    console.error('❌ Script failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
