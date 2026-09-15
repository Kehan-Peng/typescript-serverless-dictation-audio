export interface DefaultPause {
  pauseSeconds: number
  warning: boolean
}

export function getDefaultPause(charCount: number): DefaultPause {
  if (charCount === 2) return { pauseSeconds: 10, warning: false }
  if (charCount === 4) return { pauseSeconds: 20, warning: false }
  return { pauseSeconds: 10, warning: true }
}
