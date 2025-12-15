import PostCard from './PostCard'

type Item = {
  title: string
  path: string
  animeIds: string[]
  city?: string
  publishDate?: string
}

export default function PostList({ items }: { items: Item[] }) {
  if (!items?.length) {
    return <p className="text-gray-500">暂时没有文章，敬请期待。</p>
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((p) => (
        <PostCard key={p.path} {...p} />
      ))}
    </div>
  )
}
