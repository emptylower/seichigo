type JsonLdObject = Record<string, unknown>

export interface FAQItem {
  question: string
  answer: string
}

/**
 * Build an FAQPage JSON-LD schema for optional use in article pages.
 * Returns null if no valid FAQs are provided.
 *
 * @see https://schema.org/FAQPage
 */
export function buildFAQPageJsonLd(faqs: FAQItem[]): JsonLdObject | null {
  const cleaned = faqs
    .map((faq) => ({
      question: String(faq.question || '').trim(),
      answer: String(faq.answer || '').trim(),
    }))
    .filter((faq) => faq.question && faq.answer)

  if (!cleaned.length) return null

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: cleaned.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}
