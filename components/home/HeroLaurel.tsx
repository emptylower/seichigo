/**
 * 首屏 slogan 两侧的月桂枝（纯装饰）。
 *
 * 手画的内联 SVG——一根向上收窄的弧形主茎 + 三对对生小叶，全部 `currentColor`，
 * 所以灰度直接由外层 `className`（如 `text-gray-400`）决定，不写死颜色。
 * `mirrored` 给右侧那枝用：先平移一个视口宽再 `scale(-1, 1)`，翻转后仍落在 viewBox 内。
 */
export default function HeroLaurel({ className, mirrored = false }: { className?: string; mirrored?: boolean }) {
  return (
    <svg
      data-hero-laurel
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 22 26"
      width="22"
      height="26"
      className={className}
    >
      <g transform={mirrored ? 'translate(22, 0) scale(-1, 1)' : undefined}>
        <path
          data-laurel-stem
          d="M18.4 25C13.6 20.6 10.4 14.6 9.6 8.2 9.3 5.6 9.4 3.2 9.8 1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.75"
        />
        {/* 三对对生小叶，从下往上逐渐收小、张角逐渐变陡 */}
        <ellipse data-laurel-leaf cx="18.2" cy="19.4" rx="3.5" ry="1.7" fill="currentColor" opacity="0.42" transform="rotate(-28 18.2 19.4)" />
        <ellipse data-laurel-leaf cx="11.4" cy="21.1" rx="3.2" ry="1.6" fill="currentColor" opacity="0.42" transform="rotate(26 11.4 21.1)" />
        <ellipse data-laurel-leaf cx="15.6" cy="12.6" rx="3.2" ry="1.6" fill="currentColor" opacity="0.42" transform="rotate(-38 15.6 12.6)" />
        <ellipse data-laurel-leaf cx="8.9" cy="14.3" rx="2.9" ry="1.5" fill="currentColor" opacity="0.42" transform="rotate(16 8.9 14.3)" />
        <ellipse data-laurel-leaf cx="13.2" cy="5.9" rx="2.8" ry="1.4" fill="currentColor" opacity="0.42" transform="rotate(-52 13.2 5.9)" />
        <ellipse data-laurel-leaf cx="6.6" cy="7.4" rx="2.6" ry="1.3" fill="currentColor" opacity="0.42" transform="rotate(6 6.6 7.4)" />
      </g>
    </svg>
  )
}
