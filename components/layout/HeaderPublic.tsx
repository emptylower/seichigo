import Link from 'next/link'
import Image from 'next/image'
import type { SiteLocale } from './SiteShell'
import { prefixPath } from './prefixPath'
import HeaderAuthControls from './HeaderAuthControls.client'

type Props = {
  locale?: SiteLocale
}

export default function HeaderPublic({ locale = 'zh' }: Props) {
  const labels =
    locale === 'en'
      ? {
          posts: 'Posts',
          anime: 'Anime',
          city: 'Cities',
          resources: 'Resources',
          submit: 'Submit',
          admin: 'Admin',
          favorites: 'Favorites',
          signout: 'Sign out',
          signin: 'Sign in',
          signup: 'Sign up',
          user: 'User',
        }
      : {
          posts: '文章',
          anime: '作品',
          city: '城市',
          resources: '资源',
          submit: '投稿',
          admin: '管理员面板',
          favorites: '我的收藏',
          signout: '退出',
          signin: '登录',
          signup: '注册',
          user: '用户',
        }

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href={prefixPath('/', locale)} className="flex items-center gap-2">
          <Image
            src="/brand/app-logo.png"
            alt="SeichiGo"
            width={32}
            height={32}
            className="h-8 w-8 rounded-md bg-white object-cover"
            priority
          />
          <span className="font-display text-lg">SeichiGo</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href={prefixPath('/', locale)} className="hover:text-brand-600">{labels.posts}</Link>
          <Link href={prefixPath('/anime', locale)} className="hover:text-brand-600">{labels.anime}</Link>
          <Link href={prefixPath('/city', locale)} className="hover:text-brand-600">{labels.city}</Link>
          <Link href={prefixPath('/resources', locale)} className="hover:text-brand-600">{labels.resources}</Link>
          <Link href={prefixPath('/submit', locale)} className="hover:text-brand-600">{labels.submit}</Link>
          <HeaderAuthControls
            locale={locale}
            labels={{
              admin: labels.admin,
              favorites: labels.favorites,
              signout: labels.signout,
              signin: labels.signin,
              signup: labels.signup,
              user: labels.user,
            }}
          />
        </nav>
      </div>
    </header>
  )
}
