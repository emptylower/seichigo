import { checkKeywordRank } from '../lib/seo/serp/check'

async function main() {
  const args = process.argv.slice(2)
  const keywordIndex = args.indexOf('--keyword')
  const langIndex = args.indexOf('--lang')
  
  if (keywordIndex < 0 || langIndex < 0) {
    console.error('Usage: npm run seo:rank -- --keyword "your keyword" --lang zh|en|ja')
    process.exit(1)
  }
  
  const keyword = args[keywordIndex + 1]
  const lang = args[langIndex + 1]
  
  if (!keyword || !lang) {
    console.error('Missing keyword or language')
    process.exit(1)
  }
  
  console.log(`Checking rank for: "${keyword}" (${lang})`)
  
  try {
    const result = await checkKeywordRank(keyword, lang)
    
    if (result.position) {
      console.log(`✓ Position: #${result.position}`)
      console.log(`  URL: ${result.url}`)
    } else {
      console.log(`✗ Not found in top 100`)
    }
    
    console.log(`  Quota: ${result.quota.used}/${result.quota.limit}`)
    process.exit(0)
  } catch (error) {
    console.error('✗ Rank check failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
