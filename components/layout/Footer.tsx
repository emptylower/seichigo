export default function Footer() {
  return (
    <footer className="mt-16 border-t border-pink-100 py-10 text-sm text-gray-500">
      <div className="mx-auto max-w-5xl px-4">
        <p>© {new Date().getFullYear()} SeichiGo. 圣地巡礼请遵守当地法律与礼仪。</p>
        <p className="mt-2">联系：<a href="mailto:ljj231428@gmail.com" className="underline hover:text-brand-600">ljj231428@gmail.com</a></p>
      </div>
    </footer>
  )
}

