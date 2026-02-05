declare module 'google-search-results-nodejs' {
  type SerpApiJsonCallback = (data: any) => void

  class GoogleSearch {
    constructor(apiKey?: string)
    json(params: Record<string, unknown>, callback: SerpApiJsonCallback): void
  }

  const SerpApi: {
    GoogleSearch: typeof GoogleSearch
  }

  export = SerpApi
}

