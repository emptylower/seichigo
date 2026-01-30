
/**
 * Generates a consistent gradient for a given username.
 * Used for default avatars when no image is available.
 */

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash
}

function hslToHex(h: number, s: number, l: number): string {
  l /= 100
  const a = (s * Math.min(l, 1 - l)) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function getGradientColors(name: string): [string, string] {
  const hash = hashCode(name || 'default')
  
  // Use the hash to pick a starting hue (0-360)
  const h1 = Math.abs(hash) % 360
  // Pick a second hue that is 30-60 degrees away for a nice analogous gradient
  // We use a fixed offset derived from the hash slightly to add variety
  const offset = 30 + (Math.abs(hash >> 8) % 30)
  const h2 = (h1 + offset) % 360

  // Keep saturation and lightness consistent for a uniform look
  // Saturation: 65-85%, Lightness: 55-65%
  const s = 70 + (Math.abs(hash >> 4) % 15) // 70-85
  const l = 60 + (Math.abs(hash >> 12) % 10) // 60-70

  const c1 = hslToHex(h1, s, l)
  const c2 = hslToHex(h2, s, l)

  return [c1, c2]
}

export function getAvatarGradient(name: string): string {
  const [c1, c2] = getGradientColors(name)
  return `linear-gradient(135deg, ${c1}, ${c2})`
}
