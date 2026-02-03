import { prisma } from '@/lib/db/prisma'
import { TARGET_KEYWORDS } from '../keywords.config'

async function seedKeywords() {
  try {
    console.log('Starting keyword seeding...')
    
    let insertedCount = 0
    let updatedCount = 0
    
    for (const config of TARGET_KEYWORDS) {
      const existing = await prisma.seoKeyword.findFirst({
        where: {
          keyword: config.keyword,
          language: config.language,
        },
      })
      
      await prisma.seoKeyword.upsert({
        where: {
          id: existing?.id || 'new-' + Math.random().toString(36).substring(7),
        },
        update: {
          category: config.category,
          priority: config.priority,
          isActive: true,
        },
        create: {
          keyword: config.keyword,
          language: config.language,
          category: config.category,
          priority: config.priority,
          isActive: true,
        },
      })
      
      if (existing) {
        updatedCount++
      } else {
        insertedCount++
      }
    }
    
    console.log(`✓ Seeded ${insertedCount} new keywords`)
    console.log(`✓ Updated ${updatedCount} existing keywords`)
    console.log(`✓ Total: ${insertedCount + updatedCount} keywords processed`)
    
    process.exit(0)
  } catch (error) {
    console.error('Failed to seed keywords:', error)
    process.exit(1)
  }
}

seedKeywords()
