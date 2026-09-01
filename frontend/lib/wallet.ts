const SS58_PRELOAD = new TextEncoder().encode('SS58PRE')

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function isValidSs58(address: string): boolean {
  if (!address || typeof address !== 'string') return false
  if (address.length < 32 || address.length > 48) return false
  for (const ch of address) {
    if (!BASE58_ALPHABET.includes(ch)) return false
  }
  return true
}

export function parseHotkey(address: string): { valid: boolean; prefix?: number; error?: string } {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Hotkey is required' }
  }
  const trimmed = address.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: 'Hotkey is required' }
  }
  if (!isValidSs58(trimmed)) {
    return { valid: false, error: 'Invalid SS58 address format' }
  }
  return { valid: true, prefix: 42 }
}

export function formatHotkey(address: string, head = 6, tail = 6): string {
  if (!address) return ''
  if (address.length <= head + tail + 3) return address
  return `${address.slice(0, head)}...${address.slice(-tail)}`
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export async function readFromClipboard(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null
  try {
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}

export { SS58_PRELOAD }