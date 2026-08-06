declare module '*generate-public-content-snapshots.mjs' {
  export function buildLinkAssetSnapshot(options?: {
    root?: string
    generatedRoot?: string
  }): Promise<void>
  export function compileLinkAssetMarkdownToHtml(source: string): Promise<string>
}
