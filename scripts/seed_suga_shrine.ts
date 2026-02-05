
import { PrismaClient } from '@prisma/client';
import { generateJSON } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const extensions = [
  StarterKit,
  Image,
  Link,
];

const articles = [
  {
    language: 'zh',
    slug: 'suga-shrine-your-name-stairs',
    title: '须贺神社 | 《你的名字》圣地巡礼 - 那个楼梯的真实取景地',
    seoTitle: '须贺神社圣地巡礼 - 《你的名字》名场面楼梯拍摄指南',
    description: '探访东京新宿须贺神社，还原《你的名字》电影最后泷与三叶相遇的经典楼梯场景。附详细交通方式、最佳拍摄时间及周边巡礼地图。',
    tags: ['圣地巡礼', '你的名字', '东京', '须贺神社'],
    animeName: '你的名字',
    citySlug: 'tokyo',
    contentHtml: `
      <h2>那个著名的楼梯</h2>
      <p>对于《你的名字》（君の名は。）的粉丝来说，须贺神社前的这个红扶手楼梯无疑是整个东京最重要的巡礼点。</p>
      <p>在电影的最后一幕，成年的立花泷和宫水三叶在寻找彼此多年后，终于在这个楼梯上擦肩而过。泷鼓起勇气回头问道：“君の名前は？”（你的名字是？），这一幕让无数观众泪目。</p>
      <p>这个场景并非虚构，而是真实存在于东京新宿区的<b>须贺神社（Suga Shrine）</b>旁。</p>

      <h2>实地探访</h2>
      <p>当你亲自站在这个楼梯前时，会发现还原度极高。红色的扶手、蜿蜒的台阶、以及背景中的住宅区和天空，几乎与电影画面一模一样。唯一的区别可能是现实中这里更加宁静，没有电影中那样戏剧性的光影。</p>
      <img src="https://images.unsplash.com/photo-1542931287-023b922fa89b?auto=format&fit=crop&w=1000&q=80" alt="Tokyo Street" title="东京街景示意图" />
      <p>建议站在楼梯上方往下拍摄，这样可以完美复刻海报中的构图。如果想要模仿电影中的站位，可以找朋友帮忙，分别站在楼梯的上下两端。</p>

      <h2>详细信息</h2>
      <ul>
        <li><b>地址：</b>东京都新宿区须贺町5番地</li>
        <li><b>最近车站：</b>东京Metro丸之内线“四谷三丁目”站，步行约7-10分钟。</li>
        <li><b>JR路线：</b>JR中央线/总武线“四谷”站，步行约12分钟。</li>
      </ul>

      <h2>最佳拍摄时间</h2>
      <p>由于这里是普通的居民区街道，并不是专门的旅游景点，人流主要以巡礼粉丝为主。</p>
      <p><b>推荐时间：</b></p>
      <ul>
        <li><b>清晨：</b>光线柔和，人最少，可以独享整个楼梯。</li>
        <li><b>下午3-4点：</b>阳光从西边照射过来，也就是电影中画面的光影方向，最容易拍出原片的感觉。</li>
      </ul>
      <p>请注意：这里是安静的住宅区，拍摄时请保持安静，不要阻碍行人通行，不要大声喧哗。</p>

      <h2>关于须贺神社</h2>
      <p>除了楼梯，须贺神社本身也值得一逛。它创建于江户时代初期，是四谷地区的总镇守。神社内供奉着须佐之男命（须贺大神）和宇迦之御魂命（稻荷大神）。每年的例大祭也非常热闹。</p>
      <p>在这个充满缘分的地方求一个御守，或许也能像泷和三叶一样，守护属于你的珍贵缘分。</p>
    `
  },
  {
    language: 'en',
    slug: 'suga-shrine-your-name-stairs',
    title: 'Suga Shrine Stairs | Your Name Anime Pilgrimage Guide',
    seoTitle: 'Suga Shrine Guide - The Real Location of Your Name Stairs',
    description: 'Visit the iconic stairs from the anime "Your Name" (Kimi no Na wa) at Suga Shrine in Tokyo. Complete guide on how to get there, photo tips, and pilgrimage etiquette.',
    tags: ['Anime Pilgrimage', 'Your Name', 'Tokyo', 'Suga Shrine'],
    animeName: 'Your Name',
    citySlug: 'tokyo',
    contentHtml: `
      <h2>The Iconic Stairs</h2>
      <p>For fans of Makoto Shinkai's masterpiece <i>Your Name</i> (Kimi no Na wa), the stairs leading up to Suga Shrine are hallowed ground.</p>
      <p>This is the location of the movie's emotional climax, where Taki and Mitsuha, after years of searching for a feeling they couldn't name, finally cross paths. Taki turns around and asks, "Kimi no namae wa?" (What is your name?), bringing the story to its touching conclusion.</p>
      <p>Located in the Yotsuya neighborhood of Shinjuku, Tokyo, these stairs look almost exactly as they do in the film.</p>

      <h2>Visiting the Scene</h2>
      <p>The attention to detail in the anime is astounding. From the red handrails to the layout of the surrounding houses, standing here feels like stepping into the movie. </p>
      <img src="https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1000&q=80" alt="Tokyo Architecture" title="Tokyo Vibes" />
      <p><b>Photo Tip:</b> The best angle is from the top of the stairs looking down. This captures the vista of the city in the background, matching the key visual art used for the movie posters.</p>

      <h2>Access Information</h2>
      <ul>
        <li><b>Address:</b> 5 Suga-cho, Shinjuku-ku, Tokyo</li>
        <li><b>Nearest Station:</b> Yotsuya-sanchome Station (Marunouchi Line). It's about a 7-minute walk from the station.</li>
        <li><b>Alternative:</b> JR Yotsuya Station (Chuo/Sobu Line), about 12 minutes on foot.</li>
      </ul>

      <h2>Best Time to Visit</h2>
      <p>This is a residential area, not a tourist park, so it's important to be respectful.</p>
      <ul>
        <li><b>Golden Hour:</b> Late afternoon (around 3 PM to sunset) provides lighting that closely matches the movie scene.</li>
        <li><b>Early Morning:</b> If you want the stairs to yourself for a solo photo without other fans in the background, go before 8 AM.</li>
      </ul>
      <p><b>Etiquette:</b> Please keep your voice down and do not block the path for locals using the stairs for their daily commute.</p>

      <h2>About Suga Shrine</h2>
      <p>While the stairs are the main draw for anime fans, the shrine itself is historically significant. Established in the early Edo period, Suga Shrine is the guardian shrine for the Yotsuya district. It's a lovely, peaceful spot to pay respects after you've taken your photos.</p>
    `
  },
  {
    language: 'ja',
    slug: 'suga-shrine-your-name-stairs',
    title: '須賀神社の階段 | 『君の名は。』聖地巡礼ガイド',
    seoTitle: '須賀神社・男坂 - 『君の名は。』ラストシーンの舞台へ',
    description: '映画『君の名は。』のラストシーンで有名な四谷・須賀神社の階段（男坂）の聖地巡礼ガイド。アクセス、撮影のポイント、現地のマナーについて解説します。',
    tags: ['聖地巡礼', '君の名は', '東京', '須賀神社'],
    animeName: '君の名は',
    citySlug: 'tokyo',
    contentHtml: `
      <h2>あの感動のラストシーンの場所へ</h2>
      <p>新海誠監督の大ヒット映画『君の名は。』。そのポスタービジュアルやラストシーンで登場し、最も印象的な聖地として知られているのが、ここ須賀神社の階段です。</p>
      <p>大人になった瀧と三葉が、すれ違いざまに互いの存在に気づき、振り返る。「君の名前は？」と問いかけるあの場所。映画公開から時間が経った今でも、多くのファンが訪れる特別な場所です。</p>

      <h2>現地の様子と撮影ポイント</h2>
      <p>場所は東京都新宿区須賀町。階段は「男坂」と呼ばれています。赤い手すりや石段の質感、そして階段の上から見える街並みは、映画そのものです。</p>
      <img src="https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?auto=format&fit=crop&w=1000&q=80" alt="Shinjuku Streets" title="新宿の街並み" />
      <p><b>撮影のコツ：</b>キービジュアルと同じ構図を狙うなら、階段の上から下を見下ろすアングルがおすすめです。晴れた日の午後は、映画のような光の差し方を体験できるかもしれません。</p>

      <h2>アクセス</h2>
      <ul>
        <li><b>住所：</b>東京都新宿区須賀町5番地</li>
        <li><b>最寄駅：</b>東京メトロ丸ノ内線「四谷三丁目」駅から徒歩約7分</li>
        <li><b>JR：</b>中央・総武線「四谷」駅から徒歩約10分強</li>
      </ul>
      <p>住宅街の中にあるため、地図アプリを見ながら行くことをおすすめします。</p>

      <h2>巡礼時のマナーと注意点</h2>
      <p>須賀神社の階段は、近隣住民の方々が日常的に使用する生活道路でもあります。</p>
      <ul>
        <li><b>お静かに：</b>住宅街ですので、大声での会話はお控えください。</li>
        <li><b>通行優先：</b>写真撮影の際は、通行人の邪魔にならないよう配慮しましょう。</li>
        <li><b>早朝・深夜は避ける：</b>住民の方の迷惑にならない時間帯（日中）に訪れましょう。</li>
      </ul>

      <h2>須賀神社について</h2>
      <p>この神社は江戸時代初期から続く、四谷の総鎮守です。須佐之男命（すさのおのみこと）と宇迦之御魂命（うかのみたまのみこと）をお祀りしています。聖地巡礼の最後には、ぜひ神社にも参拝し、良いご縁を祈願してみてはいかがでしょうか。</p>
    `
  }
];

async function main() {
  console.log('Starting article creation...');

  const author = await prisma.user.findFirst();
  if (!author) throw new Error('No user found to set as author');
  console.log('Using author:', author.name);

  const anime = await prisma.anime.findFirst({
    where: {
      OR: [
        { name: { contains: '你的名字' } },
        { name_en: { contains: 'Your Name' } },
        { name_ja: { contains: '君の名は' } }
      ]
    }
  });
  if (!anime) throw new Error('Anime "Your Name" not found in DB');
  console.log('Found anime:', anime.name, anime.id);

  const city = await prisma.city.findFirst({
    where: { slug: 'tokyo' }
  });
  if (!city) console.warn('City "tokyo" not found, will rely on string value if model allows');

  const translationGroupId = randomUUID();
  console.log('Generated translationGroupId:', translationGroupId);

  for (const articleData of articles) {
    const jsonContent = generateJSON(articleData.contentHtml, extensions);
    
    const existing = await prisma.article.findUnique({
      where: {
        slug_language: {
          slug: articleData.slug,
          language: articleData.language
        }
      }
    });

    const data = {
      slug: articleData.slug,
      language: articleData.language,
      translationGroupId: existing?.translationGroupId || translationGroupId,
      title: articleData.title,
      seoTitle: articleData.seoTitle,
      description: articleData.description,
      animeIds: [anime.id],
      city: 'tokyo',
      routeLength: '2 hours',
      tags: articleData.tags,
      contentJson: jsonContent,
      contentHtml: articleData.contentHtml,
      status: 'published',
      authorId: author.id,
      publishedAt: new Date(),
    };

    if (existing) {
      console.log(`Updating ${articleData.language} article...`);
      await prisma.article.update({
        where: { id: existing.id },
        data: {
          ...data,
          cities: city ? {
            connectOrCreate: {
              where: { articleId_cityId: { articleId: existing.id, cityId: city.id } },
              create: { cityId: city.id }
            }
          } : undefined
        }
      });
    } else {
      console.log(`Creating ${articleData.language} article...`);
      await prisma.article.create({
        data: {
          ...data,
          cities: city ? {
            create: { cityId: city.id }
          } : undefined
        }
      });
    }
  }

  console.log('All articles processed.');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
