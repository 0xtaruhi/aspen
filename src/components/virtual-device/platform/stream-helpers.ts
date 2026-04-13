export const STREAM_SIGNAL_LIMIT = 4 * 16
export const STREAM_LAG_WARNING_THRESHOLD_MS = 10

export function formatRate(rateHz: number) {
  if (!Number.isFinite(rateHz) || rateHz <= 0) {
    return '1'
  }

  if (Number.isInteger(rateHz)) {
    return String(rateHz)
  }

  return rateHz.toFixed(2).replace(/\.?0+$/, '')
}

export function formatActualHz(rateHz: number) {
  if (!Number.isFinite(rateHz) || rateHz <= 0) {
    return '0 Hz'
  }

  if (rateHz < 10_000) {
    return `${Math.round(rateHz)} Hz`
  }

  if (rateHz < 100_000) {
    return `${(rateHz / 1_000).toFixed(1).replace(/\.?0+$/, '')} kHz`
  }

  if (rateHz < 1_000_000) {
    return `${Math.round(rateHz / 1_000)} kHz`
  }

  return `${(rateHz / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} MHz`
}

export function median(values: readonly number[]) {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle]
  }

  return (sorted[middle - 1] + sorted[middle]) / 2
}

export function computeStreamScheduleLagMs(queueFill: number, effectiveStreamRateHz: number) {
  if (queueFill <= 0) {
    return 0
  }

  return (queueFill / effectiveStreamRateHz) * 1000
}

export function shouldWarnStreamBacklog(
  queueFill: number,
  streamScheduleLagMs: number,
  thresholdMs = STREAM_LAG_WARNING_THRESHOLD_MS,
) {
  return queueFill > 0 && streamScheduleLagMs > thresholdMs
}
