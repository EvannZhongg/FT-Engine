export interface OverlayBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface OverlayOptions {
  bounds: OverlayBounds | null
  initialState: Record<string, unknown> | null
}

export function normalizeExternalUrl(value: unknown): string | null
export function normalizeOverlayOptions(value: unknown): OverlayOptions
