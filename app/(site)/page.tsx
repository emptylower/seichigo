import { getAllPosts } from '@/lib/mdx/getAllPosts'
import PostList from '@/components/blog/PostList'

export default async function HomePage() {
  const posts = await getAllPosts('zh')
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-bold">最新文章</h1>
        <PostList items={posts} />
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold">SeichiGo App 预告</h2>
        <p className="text-gray-600">未来将提供“在 App 中打开本路线”等能力。欢迎订阅/关注我们的更新。</p>
        <div className="card">Mock: 订阅入口（稍后替换成真实外部链接）</div>
      </section>
    </div>
  )
}

