import { revalidatePath } from 'next/cache'

export function safeRevalidatePath(path: string): void {
  try {
    revalidatePath(path)
  } catch {
    // Best-effort. `revalidatePath` can throw when called outside a Next.js request/static generation context
    // (e.g. unit tests or non-ISR runtimes). Revalidation failures should not break core workflows.
  }
}

