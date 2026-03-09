import type { Session } from 'next-auth'
import type { Article } from '@/lib/article/repo'
import type { ArticleStatus } from '@/lib/article/workflow'

export function mockAdminSession(): Session {
  return {
    user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin' },
    expires: '2099-01-01',
  }
}

export function mockUserSession(): Session {
  return {
    user: { id: 'user-1', email: 'user@test.com', name: 'User' },
    expires: '2099-01-01',
  }
}

export function mockArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'art-1',
    slug: 'test-article',
    language: 'zh',
    translationGroupId: null,
    authorId: 'user-1',
    title: 'Test Article',
    seoTitle: null,
    description: null,
    animeIds: [],
    city: null,
    routeLength: null,
    tags: [],
    cover: null,
    status: 'draft' as ArticleStatus,
    rejectReason: null,
    needsRevision: false,
    contentJson: { type: 'doc', content: [] },
    contentHtml: '<p>Test content</p>',
    publishedAt: null,
    lastApprovedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}
