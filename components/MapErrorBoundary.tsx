'use client'

import { Component, type ReactNode } from 'react'
import { MapUnavailablePlaceholder } from '@/components/route/MapUnavailablePlaceholder'

type MapErrorBoundaryProps = {
  children: ReactNode
  /** 占位容器 className（与地图容器保持一致，避免布局抖动） */
  className?: string
  /** 占位里列出的前 3 个点名（可选） */
  points?: Array<{ label: string; title?: string }>
}

type MapErrorBoundaryState = { hasError: boolean }

/**
 * 地图最小错误边界：RoutePreviewMap 渲染期同步错误只丢地图、不丢聊天时间线
 * （effect 内的 WebGL 初始化失败由 RoutePreviewMap 自身 try/catch 降级，
 * 边界兜渲染期抛错）。fallback 与 WebGL 占位同款。
 */
export class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('[MapErrorBoundary] 地图渲染失败，降级为占位', error)
  }

  render() {
    if (this.state.hasError) {
      return <MapUnavailablePlaceholder className={this.props.className} points={this.props.points} />
    }
    return this.props.children
  }
}
