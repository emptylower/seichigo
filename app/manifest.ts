import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SeichiGo — 动漫圣地巡礼攻略',
    short_name: 'SeichiGo',
    description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划。',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#db2777',
    icons: [
      {
        src: '/brand/app-logo.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/brand/app-logo.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
