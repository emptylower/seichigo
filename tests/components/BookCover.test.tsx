import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import BookCover from '@/components/bookstore/BookCover'

describe('BookCover localized metadata', () => {
  it('renders localized anime and city labels supplied by the server data flow', () => {
    render(
      <BookCover
        path="/en/posts/example"
        title="English post"
        animeIds={["中文作品"]}
        localizedAnimeNames={["English Anime"]}
        city="东京"
        localizedCity="Tokyo"
      />
    )

    expect(screen.getByText('English Anime')).toBeInTheDocument()
    expect(screen.getAllByText('Tokyo')).not.toHaveLength(0)
    expect(screen.queryByText('中文作品')).not.toBeInTheDocument()
    expect(screen.queryByText('东京')).not.toBeInTheDocument()
  })
})
