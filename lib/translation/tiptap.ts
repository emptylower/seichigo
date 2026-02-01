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
  
  if (node.type === 'seichiRoute' && node.attrs?.data) {
    const data = node.attrs.data
    
    if (typeof data.title === 'string' && data.title.trim()) {
      texts.push(data.title)
    }
    
    if (Array.isArray(data.spots)) {
      for (const spot of data.spots) {
        const translatableFields = ['name_zh', 'nearestStation_zh', 'photoTip', 'note', 'animeScene']
        for (const field of translatableFields) {
          const value = spot[field]
          if (typeof value === 'string' && value.trim()) {
            texts.push(value)
          }
        }
      }
    }
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
  
  if (newNode.type === 'seichiRoute' && newNode.attrs?.data) {
    newNode.attrs = {
      ...newNode.attrs,
      data: {
        ...newNode.attrs.data,
        title: newNode.attrs.data.title && translations.has(newNode.attrs.data.title)
          ? translations.get(newNode.attrs.data.title)!
          : newNode.attrs.data.title,
        spots: Array.isArray(newNode.attrs.data.spots)
          ? newNode.attrs.data.spots.map((spot: any) => {
              const newSpot = { ...spot }
              const translatableFields = ['name_zh', 'nearestStation_zh', 'photoTip', 'note', 'animeScene']
              for (const field of translatableFields) {
                const value = newSpot[field]
                if (typeof value === 'string' && translations.has(value)) {
                  newSpot[field] = translations.get(value)!
                }
              }
              return newSpot
            })
          : newNode.attrs.data.spots
      }
    }
  }
  
  if (newNode.content) {
    newNode.content = newNode.content.map(child => replaceTextNodes(child, translations))
  }
  
  return newNode
}
