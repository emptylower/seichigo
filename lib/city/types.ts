export type CityArea = {
  id: string
  name_zh: string
  name_en?: string
  name_ja?: string
}

export type City = {
  id: string
  name_zh: string
  name_en?: string
  name_ja?: string
  description_zh?: string
  description_en?: string
  areas?: CityArea[]
  cover?: string
  transportTips_zh?: string
  transportTips_en?: string
}
