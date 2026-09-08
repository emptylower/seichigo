declare module 'qrcode/lib/core/qrcode.js' {
  export type QrData = {
    modules: { size: number; data: Uint8Array | number[] }
  }
  export function create(
    data: string,
    options?: { errorCorrectionLevel?: string; version?: number; maskPattern?: number },
  ): QrData
}

declare module 'qrcode/lib/renderer/svg-tag.js' {
  import type { QrData } from 'qrcode/lib/core/qrcode.js'
  export function render(
    qrData: QrData,
    options?: {
      margin?: number
      width?: number
      scale?: number
      color?: { dark?: string; light?: string }
    },
  ): string
}
