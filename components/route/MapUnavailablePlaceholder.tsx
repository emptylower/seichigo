/**
 * 地图不可用占位（RoutePreviewMap WebGL 初始化失败 / MapErrorBoundary 兜底共用）：
 * 由调用方通过 className 保持与地图容器一致的尺寸契约，灰底居中提示；
 * points 非空时列出前 3 个点名（纯文本），保证行程信息不丢。
 */
export function MapUnavailablePlaceholder(props: {
  className?: string
  points?: Array<{ label: string; title?: string }>
}) {
  const { className = '', points = [] } = props
  const names = points.slice(0, 3).map((point) => point.title ?? point.label)
  return (
    <div className={`flex flex-col items-center justify-center gap-1 bg-gray-100 text-center text-gray-400 ${className}`}>
      <p className="text-xs">地图暂不可用（浏览器不支持 WebGL）</p>
      {names.length ? (
        <ul className="space-y-0.5 text-[11px]">
          {names.map((name, index) => (
            <li key={`${index}:${name}`}>{name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
