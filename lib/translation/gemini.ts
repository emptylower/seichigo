import fs from 'fs'
import path from 'path'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
const MAX_RETRIES = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 32000

const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Chinese (Simplified)',
  en: 'English',
  ja: 'Japanese',
}

type Glossary = Record<string, Record<string, string>>

let glossaryCache: Glossary | null = null

function loadGlossary(): Glossary {
  if (glossaryCache) return glossaryCache
  
  const glossaryPath = path.join(process.cwd(), 'lib/i18n/glossary.json')
  if (!fs.existsSync(glossaryPath)) {
    console.warn('⚠️  Glossary not found, term protection disabled')
    glossaryCache = {}
    return glossaryCache
  }
  
  glossaryCache = JSON.parse(fs.readFileSync(glossaryPath, 'utf-8')) as Glossary
  return glossaryCache
}

function protectTerms(text: string, glossary: Glossary): { protectedText: string; terms: Map<string, string> } {
  const terms = new Map<string, string>()
  let protectedText = text
  let index = 0
  
  for (const [term] of Object.entries(glossary)) {
    if (protectedText.includes(term)) {
      const placeholder = `{{TERM_${index}}}`
      terms.set(placeholder, term)
      protectedText = protectedText.replaceAll(term, placeholder)
      index++
    }
  }
  
  return { protectedText, terms }
}

function restoreTerms(text: string, terms: Map<string, string>, glossary: Glossary, targetLang: string): string {
  let restored = text
  
  for (const [placeholder, originalTerm] of terms.entries()) {
    const translation = glossary[originalTerm]?.[targetLang] || originalTerm
    restored = restored.replace(placeholder, translation)
  }
  
  return restored
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function callGemini(prompt: string, retryCount = 0): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const backoffMs = Math.min(
    INITIAL_BACKOFF_MS * Math.pow(2, retryCount),
    MAX_BACKOFF_MS
  )

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    })

    if (response.status === 429) {
      if (retryCount >= MAX_RETRIES) {
        throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries`)
      }
      await sleep(backoffMs)
      return callGemini(prompt, retryCount + 1)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) {
      throw new Error('Empty response from Gemini API')
    }

    return text
  } catch (error) {
    if (error instanceof Error && error.message.includes('Rate limit')) {
      throw error
    }

    if (retryCount < MAX_RETRIES) {
      await sleep(backoffMs)
      return callGemini(prompt, retryCount + 1)
    }

    throw error
  }
}

export async function translateText(text: string, targetLang: string): Promise<string> {
  if (!text || !text.trim()) {
    throw new Error('Text to translate cannot be empty')
  }

  const glossary = loadGlossary()
  const { protectedText, terms } = protectTerms(text, glossary)
  
  const targetLangName = LANGUAGE_NAMES[targetLang] || targetLang
  const prompt = `Translate the following text to ${targetLangName}. Preserve any placeholders like {{TERM_0}}. Only return the translation, no explanations:\n\n${protectedText}`
  
  const translated = await callGemini(prompt)
  
  let cleanedTranslation = translated.trim()
  if (cleanedTranslation.startsWith('```')) {
    cleanedTranslation = cleanedTranslation.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
  
  return restoreTerms(cleanedTranslation, terms, glossary, targetLang)
}
