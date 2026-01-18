
export type TocHeading = {
  id: string
  text: string
  level: number
  pos?: number // For editor jumping
}

export type TocProps = {
  headings: TocHeading[]
  activeId: string | null
  onHeadingClick: (heading: TocHeading) => void
  className?: string
}
