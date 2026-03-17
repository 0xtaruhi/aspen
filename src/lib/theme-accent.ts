const DEFAULT_THEME_ACCENT = '#2563eb'

export const APP_THEME_PRESET_COLORS = {
  blue: '#2563eb',
  emerald: '#059669',
  teal: '#0f766e',
  amber: '#d97706',
  rose: '#e11d48',
  violet: '#7c3aed',
} as const

export type AppThemePresetColor = keyof typeof APP_THEME_PRESET_COLORS

type RgbColor = {
  r: number
  g: number
  b: number
}

type HslColor = {
  h: number
  s: number
  l: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function parseHexColor(value: string): RgbColor | null {
  const normalized = value.trim()
  const match = normalized.match(/^#?([0-9a-f]{6})$/i)
  if (!match) {
    return null
  }

  const hex = match[1]
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function toHex(value: number) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')
}

function rgbToHex(color: RgbColor) {
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
}

function mixColors(source: RgbColor, target: RgbColor, amount: number): RgbColor {
  const weight = clamp(amount, 0, 1)
  const inverse = 1 - weight

  return {
    r: source.r * inverse + target.r * weight,
    g: source.g * inverse + target.g * weight,
    b: source.b * inverse + target.b * weight,
  }
}

function rgbToHsl(color: RgbColor): HslColor {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6
    } else if (max === g) {
      h = (b - r) / delta + 2
    } else {
      h = (r - g) / delta + 4
    }
  }

  return {
    h: (h * 60 + 360) % 360,
    s,
    l,
  }
}

function hueToRgb(p: number, q: number, t: number) {
  let value = t
  if (value < 0) {
    value += 1
  }
  if (value > 1) {
    value -= 1
  }
  if (value < 1 / 6) {
    return p + (q - p) * 6 * value
  }
  if (value < 1 / 2) {
    return q
  }
  if (value < 2 / 3) {
    return p + (q - p) * (2 / 3 - value) * 6
  }
  return p
}

function hslToRgb(color: HslColor): RgbColor {
  const h = (((color.h % 360) + 360) % 360) / 360
  const s = clamp(color.s, 0, 1)
  const l = clamp(color.l, 0, 1)

  if (s === 0) {
    const value = l * 255
    return { r: value, g: value, b: value }
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  return {
    r: hueToRgb(p, q, h + 1 / 3) * 255,
    g: hueToRgb(p, q, h) * 255,
    b: hueToRgb(p, q, h - 1 / 3) * 255,
  }
}

function rotateHue(color: string, degrees: number, lightnessDelta = 0, saturationDelta = 0) {
  const parsed = parseHexColor(color)
  if (!parsed) {
    return color
  }

  const hsl = rgbToHsl(parsed)
  const rotated = hslToRgb({
    h: hsl.h + degrees,
    s: clamp(hsl.s + saturationDelta, 0, 1),
    l: clamp(hsl.l + lightnessDelta, 0, 1),
  })

  return rgbToHex(rotated)
}

function linearizeChannel(value: number) {
  const normalized = value / 255
  if (normalized <= 0.03928) {
    return normalized / 12.92
  }

  return ((normalized + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: RgbColor) {
  const r = linearizeChannel(color.r)
  const g = linearizeChannel(color.g)
  const b = linearizeChannel(color.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function pickForeground(color: string, light = '#f8fafc', dark = '#0f172a') {
  const parsed = parseHexColor(color)
  if (!parsed) {
    return light
  }

  return relativeLuminance(parsed) > 0.42 ? dark : light
}

export function normalizeThemeAccentColor(value: unknown) {
  if (typeof value !== 'string') {
    return DEFAULT_THEME_ACCENT
  }

  const parsed = parseHexColor(value)
  if (!parsed) {
    return DEFAULT_THEME_ACCENT
  }

  return rgbToHex(parsed)
}

function buildChartPalette(accent: string, isDark: boolean) {
  return {
    chart1: isDark
      ? rgbToHex(mixColors(parseHexColor(accent)!, { r: 255, g: 255, b: 255 }, 0.12))
      : rgbToHex(mixColors(parseHexColor(accent)!, { r: 0, g: 0, b: 0 }, 0.1)),
    chart2: rotateHue(accent, 26, isDark ? 0.08 : -0.02, -0.04),
    chart3: rotateHue(accent, -32, isDark ? 0.02 : -0.04, -0.06),
    chart4: rotateHue(accent, 54, isDark ? 0.12 : 0.04, -0.14),
    chart5: rotateHue(accent, -58, isDark ? 0.1 : 0.03, -0.1),
  }
}

export function applyThemeAccentColor(accent: string) {
  if (typeof document === 'undefined') {
    return
  }

  const normalized = normalizeThemeAccentColor(accent)
  const parsed = parseHexColor(normalized)
  if (!parsed) {
    return
  }

  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 0, g: 0, b: 0 }

  const lightPrimary = rgbToHex(mixColors(parsed, black, 0.14))
  const darkPrimary = rgbToHex(mixColors(parsed, white, 0.12))
  const lightCharts = buildChartPalette(normalized, false)
  const darkCharts = buildChartPalette(normalized, true)

  const rootStyle = document.documentElement.style
  rootStyle.setProperty('--theme-primary-light', lightPrimary)
  rootStyle.setProperty('--theme-primary-foreground-light', pickForeground(lightPrimary))
  rootStyle.setProperty('--theme-ring-light', normalized)
  rootStyle.setProperty('--theme-sidebar-primary-light', lightPrimary)
  rootStyle.setProperty('--theme-sidebar-primary-foreground-light', pickForeground(lightPrimary))
  rootStyle.setProperty('--theme-chart-1-light', lightCharts.chart1)
  rootStyle.setProperty('--theme-chart-2-light', lightCharts.chart2)
  rootStyle.setProperty('--theme-chart-3-light', lightCharts.chart3)
  rootStyle.setProperty('--theme-chart-4-light', lightCharts.chart4)
  rootStyle.setProperty('--theme-chart-5-light', lightCharts.chart5)

  rootStyle.setProperty('--theme-primary-dark', darkPrimary)
  rootStyle.setProperty('--theme-primary-foreground-dark', pickForeground(darkPrimary))
  rootStyle.setProperty('--theme-ring-dark', darkPrimary)
  rootStyle.setProperty('--theme-sidebar-primary-dark', darkPrimary)
  rootStyle.setProperty('--theme-sidebar-primary-foreground-dark', pickForeground(darkPrimary))
  rootStyle.setProperty('--theme-chart-1-dark', darkCharts.chart1)
  rootStyle.setProperty('--theme-chart-2-dark', darkCharts.chart2)
  rootStyle.setProperty('--theme-chart-3-dark', darkCharts.chart3)
  rootStyle.setProperty('--theme-chart-4-dark', darkCharts.chart4)
  rootStyle.setProperty('--theme-chart-5-dark', darkCharts.chart5)
}

export { DEFAULT_THEME_ACCENT }
