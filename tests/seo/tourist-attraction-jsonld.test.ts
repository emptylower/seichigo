import { describe, expect, it } from 'vitest'
import { buildTouristAttractionJsonLd } from '@/lib/seo/touristAttractionJsonLd'

describe('buildTouristAttractionJsonLd', () => {
  it('always includes @context, @type, and name', () => {
    const result = buildTouristAttractionJsonLd({ name: 'Test Attraction' })
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('TouristAttraction')
    expect(result.name).toBe('Test Attraction')
  })

  it('includes optional fields when provided', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test Attraction',
      description: 'A test description',
      url: 'https://example.com',
      geo: { latitude: 35.6762, longitude: 139.6503 },
      image: 'https://example.com/image.jpg',
      touristType: 'Anime Pilgrimage Site',
      inLanguage: 'ja',
      alternateName: ['Alternative Name 1', 'Alternative Name 2'],
    })

    expect(result.description).toBe('A test description')
    expect(result.url).toBe('https://example.com/')
    expect(result.geo).toEqual({
      '@type': 'GeoCoordinates',
      latitude: 35.6762,
      longitude: 139.6503,
    })
    expect(result.image).toEqual(['https://example.com/image.jpg'])
    expect(result.touristType).toBe('Anime Pilgrimage Site')
    expect(result.inLanguage).toBe('ja')
    expect(result.alternateName).toEqual(['Alternative Name 1', 'Alternative Name 2'])
  })

  it('omits description when empty or null', () => {
    const result1 = buildTouristAttractionJsonLd({ name: 'Test', description: '' })
    expect(result1.description).toBeUndefined()

    const result2 = buildTouristAttractionJsonLd({ name: 'Test', description: null })
    expect(result2.description).toBeUndefined()

    const result3 = buildTouristAttractionJsonLd({ name: 'Test', description: '   ' })
    expect(result3.description).toBeUndefined()
  })

  it('omits geo when latitude or longitude is null', () => {
    const result1 = buildTouristAttractionJsonLd({
      name: 'Test',
      geo: { latitude: 35.6762, longitude: null as any },
    })
    expect(result1.geo).toBeUndefined()

    const result2 = buildTouristAttractionJsonLd({
      name: 'Test',
      geo: { latitude: null as any, longitude: 139.6503 },
    })
    expect(result2.geo).toBeUndefined()

    const result3 = buildTouristAttractionJsonLd({ name: 'Test', geo: null })
    expect(result3.geo).toBeUndefined()
  })

  it('includes geo when both latitude and longitude are valid numbers', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      geo: { latitude: 0, longitude: 0 },
    })
    expect(result.geo).toEqual({
      '@type': 'GeoCoordinates',
      latitude: 0,
      longitude: 0,
    })
  })

  it('rejects image with relative protocol', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      image: '//example.com/image.jpg',
    })
    expect(result.image).toBeUndefined()
  })

  it('rejects image with non-http protocol', () => {
    const result1 = buildTouristAttractionJsonLd({
      name: 'Test',
      image: 'ftp://example.com/image.jpg',
    })
    expect(result1.image).toBeUndefined()

    const result2 = buildTouristAttractionJsonLd({
      name: 'Test',
      image: 'javascript:alert(1)',
    })
    expect(result2.image).toBeUndefined()
  })

  it('includes image with valid https URL', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      image: 'https://example.com/image.jpg',
    })
    expect(result.image).toEqual(['https://example.com/image.jpg'])
  })

  it('includes image with valid http URL', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      image: 'http://example.com/image.jpg',
    })
    expect(result.image).toEqual(['http://example.com/image.jpg'])
  })

  it('omits image when empty or null', () => {
    const result1 = buildTouristAttractionJsonLd({ name: 'Test', image: '' })
    expect(result1.image).toBeUndefined()

    const result2 = buildTouristAttractionJsonLd({ name: 'Test', image: null })
    expect(result2.image).toBeUndefined()

    const result3 = buildTouristAttractionJsonLd({ name: 'Test', image: '   ' })
    expect(result3.image).toBeUndefined()
  })

  it('filters out empty strings from alternateName', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      alternateName: ['Valid Name', '', '   ', 'Another Valid Name'],
    })
    expect(result.alternateName).toEqual(['Valid Name', 'Another Valid Name'])
  })

  it('omits alternateName when all values are empty', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      alternateName: ['', '   ', ''],
    })
    expect(result.alternateName).toBeUndefined()
  })

  it('omits alternateName when array is empty', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      alternateName: [],
    })
    expect(result.alternateName).toBeUndefined()
  })

  it('omits touristType when empty or null', () => {
    const result1 = buildTouristAttractionJsonLd({ name: 'Test', touristType: '' })
    expect(result1.touristType).toBeUndefined()

    const result2 = buildTouristAttractionJsonLd({ name: 'Test', touristType: null })
    expect(result2.touristType).toBeUndefined()

    const result3 = buildTouristAttractionJsonLd({ name: 'Test', touristType: '   ' })
    expect(result3.touristType).toBeUndefined()
  })

  it('omits inLanguage when empty or null', () => {
    const result1 = buildTouristAttractionJsonLd({ name: 'Test', inLanguage: '' })
    expect(result1.inLanguage).toBeUndefined()

    const result2 = buildTouristAttractionJsonLd({ name: 'Test', inLanguage: null })
    expect(result2.inLanguage).toBeUndefined()

    const result3 = buildTouristAttractionJsonLd({ name: 'Test', inLanguage: '   ' })
    expect(result3.inLanguage).toBeUndefined()
  })

  it('omits url when empty or null', () => {
    const result1 = buildTouristAttractionJsonLd({ name: 'Test', url: '' })
    expect(result1.url).toBeUndefined()

    const result2 = buildTouristAttractionJsonLd({ name: 'Test', url: null })
    expect(result2.url).toBeUndefined()

    const result3 = buildTouristAttractionJsonLd({ name: 'Test', url: '   ' })
    expect(result3.url).toBeUndefined()
  })

  it('rejects url with relative protocol', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      url: '//example.com',
    })
    expect(result.url).toBeUndefined()
  })

  it('includes url with valid https URL', () => {
    const result = buildTouristAttractionJsonLd({
      name: 'Test',
      url: 'https://example.com',
    })
    expect(result.url).toBe('https://example.com/')
  })
})
