/** 背景图基名，AVIF 优先、WebP 兜底；文件由 `scripts/generate-home-hero-bg.mts` 产出 */
const LANDSCAPE = '/images/home/hero-bg-landscape'
const PORTRAIT = '/images/home/hero-bg-portrait'

/** 桌面视口（`lg`）用横版 1672×941，以下用竖版 941×1672 */
const DESKTOP_MEDIA = '(min-width: 1024px)'

/**
 * 花瓣：位置、大小、动画名与时长全部写死——首屏背景是 SSR 直出的，
 * 任何随机都会让服务端与客户端不同串。6 片共用 3 条 keyframes，靠时长与延时错开。
 */
const PETALS = [
  { left: '12%', top: '-6%', size: 18, anim: 1, duration: 15, delay: 0 },
  { left: '31%', top: '-12%', size: 13, anim: 2, duration: 18, delay: 2.5 },
  { left: '52%', top: '-8%', size: 16, anim: 3, duration: 13, delay: 1.2 },
  { left: '68%', top: '-14%', size: 11, anim: 1, duration: 17, delay: 4 },
  { left: '81%', top: '-5%', size: 15, anim: 2, duration: 12, delay: 6.5 },
  { left: '93%', top: '-11%', size: 12, anim: 3, duration: 16, delay: 3.2 },
] as const

/**
 * 首屏插画背景（第十四轮）：整屏一张富士山 / 晴空塔 / 樱花的浅色插画，
 * 上面压三层白色渐变把文案区垫出可读的底，再飘几片樱花。
 *
 * 三条硬约束与第十三轮一致：
 * 1. 纯装饰——`aria-hidden` + `pointer-events-none`，不进焦点顺序；
 * 2. SSR 与客户端输出完全一致——没有随机、没有时间、没有 `window`，
 *    `prefers-reduced-motion` 与断点一律交给 CSS media query，不用 hook；
 * 3. 只用 `transform` / `opacity` 动，不用 `filter: blur`（移动端合成代价太高）。
 *
 * `<img>` 是首屏唯一的 LCP 候选：`eager` + `fetchpriority=high` 直出，
 * 桌面对齐右中（富士山与晴空塔在画面右侧），移动端对齐下中（樱花与城市在下半张）。
 */
export default function HomeHeroBackground() {
  return (
    <div
      data-testid="hero-background"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 select-none overflow-hidden"
    >
      <style>{`
        /* 移动端：自上而下压白，标题与输入框落在最白的一段上 */
        .seichigo-hero-bg-side {
          background-image: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0.92) 0%,
            rgba(255, 255, 255, 0.3) 55%,
            rgba(255, 255, 255, 0) 100%
          );
        }
        .seichigo-hero-bg-top {
          background-image: linear-gradient(to bottom, #ffffff 0%, rgba(255, 255, 255, 0) 100%);
        }
        .seichigo-hero-bg-bottom {
          background-image: linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, #ffffff 100%);
        }
        /* 桌面：文案在左栏，改成自左向右压白，右半张插画完整露出来 */
        @media (min-width: 1024px) {
          .seichigo-hero-bg-side {
            background-image: linear-gradient(
              to right,
              rgba(255, 255, 255, 0.95) 0%,
              rgba(255, 255, 255, 0.95) 35%,
              rgba(255, 255, 255, 0.35) 60%,
              rgba(255, 255, 255, 0) 85%
            );
          }
        }
        .seichigo-hero-petal { opacity: 0.75; }
        @keyframes seichigo-hero-petal-1 {
          from { transform: translate3d(0, -8vh, 0) rotate(0deg); }
          to { transform: translate3d(-6vw, 108vh, 0) rotate(220deg); }
        }
        @keyframes seichigo-hero-petal-2 {
          from { transform: translate3d(0, -8vh, 0) rotate(20deg); }
          to { transform: translate3d(4vw, 108vh, 0) rotate(-180deg); }
        }
        @keyframes seichigo-hero-petal-3 {
          from { transform: translate3d(0, -8vh, 0) rotate(-15deg); }
          to { transform: translate3d(-3vw, 108vh, 0) rotate(300deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .seichigo-hero-petal { animation: none; opacity: 0; }
        }
      `}</style>

      <picture>
        <source media={DESKTOP_MEDIA} type="image/avif" srcSet={`${LANDSCAPE}.avif`} />
        <source media={DESKTOP_MEDIA} type="image/webp" srcSet={`${LANDSCAPE}.webp`} />
        <source type="image/avif" srcSet={`${PORTRAIT}.avif`} />
        <source type="image/webp" srcSet={`${PORTRAIT}.webp`} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${PORTRAIT}.webp`}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="h-full w-full object-cover object-bottom lg:object-right"
        />
      </picture>

      <div data-hero-gradient="side" className="seichigo-hero-bg-side absolute inset-0" />
      {/* 页眉正下方那条：让通栏首屏与白色页眉自然接上 */}
      <div data-hero-gradient="top" className="seichigo-hero-bg-top absolute inset-x-0 top-0 h-16" />
      {/* 收尾：最后 18% 淡成纯白，直接接住第二屏的白底 */}
      <div data-hero-gradient="bottom" className="seichigo-hero-bg-bottom absolute inset-x-0 bottom-0 h-[18%]" />

      <div data-hero-petals className="absolute inset-0 hidden overflow-hidden lg:block">
        {PETALS.map((petal, index) => (
          <svg
            key={index}
            data-hero-petal={index + 1}
            className="seichigo-hero-petal absolute"
            style={{
              left: petal.left,
              top: petal.top,
              width: petal.size,
              height: petal.size,
              animation: `seichigo-hero-petal-${petal.anim} ${petal.duration}s linear ${petal.delay}s infinite`,
            }}
            viewBox="0 0 24 24"
            focusable="false"
          >
            {/* 一片单瓣樱花：两段对称的三次贝塞尔，尖端朝上 */}
            <path
              d="M12 1 C17 6 20 12 12 23 C4 12 7 6 12 1 Z"
              fill="#f9a8d4"
              opacity="0.85"
            />
          </svg>
        ))}
      </div>
    </div>
  )
}
