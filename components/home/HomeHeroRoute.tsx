/** 与背景横版插画（1672×941）同一坐标系：路径写死在画面上，不再依赖点阵与经纬度 */
export const HERO_ROUTE_VIEWBOX = '0 0 1672 941'

/**
 * 沿城市天际线从左往右走到晴空塔脚下。
 *
 * 设计稿给的是 `M 560 830 …`（更贴海湾），实测在 1440×900 上那一段正好压在
 * 首屏收尾行的三张入口卡上，线从卡片中间穿过去很脏；整条抬到 y≈580–640 这一带，
 * 落在作品名滚动条与入口卡之间那片空白上，右端仍收在晴空塔脚下。
 */
export const HERO_ROUTE_PATH = 'M 520 620 Q 790 584 1000 576 Q 1215 568 1350 600 Q 1430 619 1470 640'

/** 路径的 4 个锚点，即 4 个标记的位置（最后一个是终点，带定位图钉） */
export const HERO_ROUTE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [520, 620],
  [1000, 576],
  [1350, 600],
  [1470, 640],
]

const BRAND = '#ec4899'
const PLANNED = '#d1d5db'
const MARK_RADIUS = 9

/** 1672 单位的画面在 1440 宽的桌面上约 0.9 px/单位，4 个单位落在 3–4px */
const STROKE_WIDTH = 4

/** 画线 0.4s 后起步、2.4s 画完；标记按顺序 0.6s 一个；光环等画完再开始循环 */
const DRAW_DELAY_S = 0.4
const DRAW_DURATION_S = 2.4
const MARK_STEP_S = 0.6
const HALO_START_S = DRAW_DELAY_S + DRAW_DURATION_S

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 压在插画背景上的「一笔画」巡礼路线（第十四轮改造）：
 * 一条写死的固定路径 + 4 个白心粉边标记，末端带一枚定位图钉。
 *
 * 关键是**和背景 `<img>` 落在同一个盒子、同一种裁切**：背景桌面用
 * `object-fit: cover` + `object-position: right center`，SVG 的等价写法就是
 * `preserveAspectRatio="xMaxYMid slice"`——用 `xMidYMid` 会让路径整体左移，
 * 脱离画面里的海湾与城市。
 *
 * 纯渲染、无 state、无 `window` 读取，SSR 与客户端输出一致；
 * `prefers-reduced-motion` 交给组件内 `<style>` 的 media query（不是 hook），
 * 避免首帧与水合后不一致。只在 `lg` 以上出现（移动端背景是竖版、构图不同）。
 */
export default function HomeHeroRoute() {
  return (
    <div
      data-hero-route
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden select-none overflow-hidden lg:block"
    >
      <svg
        viewBox={HERO_ROUTE_VIEWBOX}
        preserveAspectRatio="xMaxYMid slice"
        aria-hidden="true"
        focusable="false"
        className="h-full w-full"
      >
        <style>{`
          .seichigo-hero-route-line {
            stroke-dasharray: 1;
            stroke-dashoffset: 1;
            animation: seichigo-hero-route-draw ${DRAW_DURATION_S}s ease-in-out ${DRAW_DELAY_S}s forwards;
          }
          @keyframes seichigo-hero-route-draw { to { stroke-dashoffset: 0; } }
          .seichigo-hero-route-mark {
            opacity: 0;
            transform-box: fill-box;
            transform-origin: center;
            animation: seichigo-hero-route-mark 400ms ease-out forwards;
          }
          @keyframes seichigo-hero-route-mark {
            from { opacity: 0; transform: scale(0.6); }
            to { opacity: 1; transform: scale(1); }
          }
          .seichigo-hero-route-halo {
            opacity: 0;
            transform-box: fill-box;
            transform-origin: center;
            animation: seichigo-hero-route-halo 3s ease-out infinite;
          }
          @keyframes seichigo-hero-route-halo {
            0% { opacity: 0.5; transform: scale(1); }
            100% { opacity: 0; transform: scale(3); }
          }
          @media (prefers-reduced-motion: reduce) {
            .seichigo-hero-route-line { animation: none; stroke-dashoffset: 0; }
            .seichigo-hero-route-mark { animation: none; opacity: 1; }
            .seichigo-hero-route-halo { animation: none; opacity: 0; }
          }
        `}</style>

        {/* 计划中的路线：静态灰虚线打底，主路径画到哪儿就把它盖到哪儿 */}
        <path
          data-hero-route-planned
          d={HERO_ROUTE_PATH}
          fill="none"
          stroke={PLANNED}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray="14 12"
          strokeLinecap="round"
          opacity={0.85}
        />
        <path
          className="seichigo-hero-route-line"
          d={HERO_ROUTE_PATH}
          pathLength={1}
          fill="none"
          stroke={BRAND}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />

        {HERO_ROUTE_POINTS.map(([x, y], index) => {
          const last = index === HERO_ROUTE_POINTS.length - 1
          return (
            <g
              key={`${x}:${y}`}
              className="seichigo-hero-route-mark"
              style={{ animationDelay: `${round(DRAW_DELAY_S + index * MARK_STEP_S)}s` }}
            >
              <circle
                data-hero-route-halo
                className="seichigo-hero-route-halo"
                cx={x}
                cy={y}
                r={MARK_RADIUS}
                fill={BRAND}
                style={{ animationDelay: `${round(HALO_START_S + index * 0.15)}s` }}
              />
              <circle
                data-hero-route-dot
                cx={x}
                cy={y}
                r={MARK_RADIUS}
                fill="#ffffff"
                stroke={BRAND}
                strokeWidth={4}
              />
              {last ? (
                /* 终点多一枚定位图钉：钉尖正好停在锚点正上方，圆头里留一个白心 */
                <g data-hero-route-pin>
                  <path d={`M ${x} ${y - 14} l -13 -22 a 15 15 0 1 1 26 0 z`} fill={BRAND} />
                  <circle cx={x} cy={y - 41} r={5.5} fill="#ffffff" />
                </g>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
