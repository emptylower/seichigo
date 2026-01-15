import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">文章不存在或已下架</h1>
      <p className="text-gray-600">你访问的文章可能已被删除、下架，或链接有误。</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/" className="btn-primary no-underline hover:no-underline">
          返回首页
        </Link>
        <Link href="/anime" className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 no-underline hover:bg-gray-50 hover:no-underline">
          浏览作品
        </Link>
      </div>
    </div>
  )
}

