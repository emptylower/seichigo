export type Comment = {
  id: string
  articleId: string | null
  mdxSlug: string | null
  authorId: string
  parentId: string | null
  content: string
  contentHtml: string
  createdAt: Date
}

export type CommentRepo = {
  create(data: {
    articleId?: string | null
    mdxSlug?: string | null
    authorId: string
    parentId?: string | null
    content: string
    contentHtml: string
  }): Promise<Comment>

  findById(id: string): Promise<Comment | null>

  findByTarget(params: {
    articleId?: string
    mdxSlug?: string
  }): Promise<Comment[]>

  delete(id: string): Promise<void>

  toggleLike(commentId: string, userId: string): Promise<{
    liked: boolean
    count: number
  }>

  getLikeStatus(commentId: string, userId: string): Promise<boolean>

  getLikeCount(commentId: string): Promise<number>
}
