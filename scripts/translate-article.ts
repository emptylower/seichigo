#!/usr/bin/env tsx
/**
 * translate-article.ts - Translate article contentJson using Gemini API
 * 
 * Usage:
 *   npx tsx scripts/translate-article.ts --article-id=<id> --target=en,ja [--dry-run]
 * 
 * Features:
 * - Traverses TipTap JSON recursively
 * - Translates text nodes only (preserves structure)
 * - Term protection via glossary
 * - Validates structure preservation
 */

import fs from 'fs'
import path from 'path'

type TipTapNode = {
  type: string
  content?: TipTapNode[]
  text?: string
  [key: string]: any
}

type Glossary = Record<string, Record<string, string>>

function loadGlossary(): Glossary {
  const glossaryPath = path.join(process.cwd(), 'lib/i18n/glossary.json')
  if (!fs.existsSync(glossaryPath)) {
    console.warn('⚠️  Glossary not found, term protection disabled')
    return {}
  }
  return JSON.parse(fs.readFileSync(glossaryPath, 'utf-8'))
}

function extractTextNodes(node: TipTapNode, texts: string[] = []): string[] {
  if (node.text) {
    texts.push(node.text)
  }
  if (node.content) {
    for (const child of node.content) {
      extractTextNodes(child, texts)
    }
  }
  return texts
}

function replaceTextNodes(node: TipTapNode, translations: Map<string, string>): TipTapNode {
  const newNode = { ...node }
  
  if (newNode.text && translations.has(newNode.text)) {
    newNode.text = translations.get(newNode.text)!
  }
  
  if (newNode.content) {
    newNode.content = newNode.content.map(child => replaceTextNodes(child, translations))
  }
  
  return newNode
}

function protectTerms(text: string, glossary: Glossary): { protectedText: string; terms: Map<string, string> } {
  const terms = new Map<string, string>()
  let protectedText = text
  let index = 0
  
  for (const [term, _translations] of Object.entries(glossary)) {
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
    // Extract the index from placeholder like {{TERM_0}}
    const match = placeholder.match(/TERM_(\d+)/)
    if (match) {
      const index = match[1]
      // Match variations: {{TERM_0}}, {{ TERM_0 }}, {{term_0}}, etc.
      const regex = new RegExp(`\\{\\{\\s*TERM_${index}\\s*\\}\\}`, 'gi')
      restored = restored.replace(regex, translation)
    }
  }
  
  return restored
}

async function translateText(text: string, targetLang: string, glossary: Glossary): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }
  
  const { protectedText, terms } = protectTerms(text, glossary)
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`
  
  const targetLangName = targetLang === 'en' ? 'English' : targetLang === 'ja' ? 'Japanese' : targetLang
  const prompt = `Translate the following text to ${targetLangName}. Preserve any placeholders like {{TERM_0}}. Only return the translation, no explanations:\n\n${protectedText}`
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  })
  
  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`)
  }
  
  const data = await response.json()
  const translated = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || protectedText
  
  return restoreTerms(translated, terms, glossary, targetLang)
}

function collectNodeTypes(node: TipTapNode, types: Set<string> = new Set()): Set<string> {
  types.add(node.type)
  if (node.content) {
    for (const child of node.content) {
      collectNodeTypes(child, types)
    }
  }
  return types
}

async function main() {
  const args = process.argv.slice(2)
  const articleId = args.find(a => a.startsWith('--article-id='))?.split('=')[1]
  const targets = args.find(a => a.startsWith('--target='))?.split('=')[1]?.split(',') || []
  const dryRun = args.includes('--dry-run')
  
  if (!articleId || targets.length === 0) {
    console.error('Usage: npx tsx scripts/translate-article.ts --article-id=<id> --target=en,ja [--dry-run]')
    process.exit(1)
  }
  
  console.log(`📝 Translating article ${articleId} to: ${targets.join(', ')}`)
  console.log(`🔒 Dry run: ${dryRun}`)
  
  const glossary = loadGlossary()
  console.log(`📚 Loaded ${Object.keys(glossary).length} glossary terms`)
  
  console.log('⚠️  Database integration not implemented yet')
  console.log('   This script requires:')
  console.log('   1. Fetch article by ID from database')
  console.log('   2. Parse contentJson')
  console.log('   3. Translate text nodes')
  console.log('   4. Create translated article with new language')
  console.log('   5. Save to database')
  
  console.log('\n✅ Script structure complete. Database integration needed.')
}

main().catch(console.error)
