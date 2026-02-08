
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Find Author (first user)
  const author = await prisma.user.findFirst();
  console.log('Author:', author?.id, author?.name);

  // 2. Find Anime "Your Name" (exact match or like)
  const anime = await prisma.anime.findFirst({
    where: {
      OR: [
        { name: { contains: '你的名字' } },
        { name_en: { contains: 'Your Name' } },
        { name_ja: { contains: '君の名は' } }
      ]
    }
  });
  console.log('Anime:', anime?.id, anime?.name);

  // 3. Find City "Tokyo"
  const city = await prisma.city.findFirst({
    where: {
      slug: 'tokyo'
    }
  });
  console.log('City:', city?.id, city?.slug);

  // 4. Find reference article content structure
  const refArticle = await prisma.article.findFirst({
    where: {
      slug: '你的名字-your-name-tokyo-from-hida-to-suwa' // Note: this might be the slug in the URL, verify against DB
    }
  });
  
  // If not found by exact slug, try searching
  if (!refArticle) {
    const searchArticle = await prisma.article.findFirst({
      where: {
        title: { contains: '你的名字' }
      }
    });
    if (searchArticle) {
        console.log('Reference Article Found by title:', searchArticle.slug);
        console.log('ContentJson sample:', JSON.stringify(searchArticle.contentJson).substring(0, 200));
    } else {
        console.log('Reference Article NOT found');
    }
  } else {
    console.log('Reference Article Found:', refArticle.slug);
    console.log('ContentJson sample:', JSON.stringify(refArticle.contentJson).substring(0, 200));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
