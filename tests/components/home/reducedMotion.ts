/** jsdom 没有 matchMedia：按需装一个只认 prefers-reduced-motion 的桩 */
export function setPrefersReducedMotion(reduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

export function clearMatchMediaStub(): void {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'matchMedia')
}
