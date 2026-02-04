declare module '*ai-api-smoke.mjs' {
  export function joinUrl(base: string, path: string): string
  export function isRedirectStatus(status: number): boolean
  export function fetchFollowRedirects(
    url: string,
    options: Record<string, unknown>,
    maxHops?: number
  ): Promise<Response>
  export function assertJsonEndpoint(path: string, expectedStatuses: number[]): Promise<void>
  export function main(): Promise<void>
}
