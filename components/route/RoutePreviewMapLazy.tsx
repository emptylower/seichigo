'use client'

import dynamic from 'next/dynamic'
import type { RoutePreviewMapProps } from './RoutePreviewMap'

const LazyRoutePreviewMap = dynamic(
  () => import('./RoutePreviewMap').then((mod) => mod.RoutePreviewMap),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-gray-100" aria-hidden="true" />,
  },
)

/**
 * MapLibre（含 WebGL shader，服务端包内 ~1.1 MB）只能在浏览器跑：`next/dynamic`
 * + `ssr: false` 把整库移出服务端渲染路径（Worker 冷启动与包体积正相关）。
 * `dynamic()` 的 loading 占位拿不到 props，用 `h-full w-full` 空白容器——
 * 现有调用方的父容器都有确定尺寸（`absolute inset-0` / `h-full`），占位与
 * 实际地图同尺寸、灰底与地图容器底色一致，不跳动。
 * 用法与 `RoutePreviewMap` 完全相同；纯类型引入请继续用 `./RoutePreviewMap`。
 */
export function RoutePreviewMap(props: RoutePreviewMapProps) {
  return <LazyRoutePreviewMap {...props} />
}
