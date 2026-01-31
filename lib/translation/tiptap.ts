export type TipTapNode = {
  type: string
  content?: TipTapNode[]
  text?: string
  marks?: any[]
  attrs?: Record<string, any>
  [key: string]: any
}

export function extractTextNodes(node: TipTapNode, texts: string[] = []): string[] {
  if (node.text) {
    texts.push(node.text)
  }
  if (node.content) {
    for (const child of node.content) {
      extractTextNodes(child, texts)
    }
  }
  return texts
}

export function replaceTextNodes(node: TipTapNode, translations: Map<string, string>): TipTapNode {
  const newNode = { ...node }
  
  if (newNode.text && translations.has(newNode.text)) {
    newNode.text = translations.get(newNode.text)!
  }
  
  if (newNode.content) {
    newNode.content = newNode.content.map(child => replaceTextNodes(child, translations))
  }
  
  return newNode
}
