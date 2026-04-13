import { ref } from 'vue'

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createBufferedLogStream(flushDelayMs = 50) {
  const liveLog = ref('')
  let buffer = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    if (!buffer) {
      return
    }

    liveLog.value += buffer
    buffer = ''
  }

  function scheduleFlush() {
    if (flushTimer) {
      return
    }

    flushTimer = setTimeout(() => {
      flush()
    }, flushDelayMs)
  }

  function append(text: string) {
    if (!text) {
      return
    }

    buffer += text
    scheduleFlush()
  }

  function clear() {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }

    buffer = ''
    liveLog.value = ''
  }

  return {
    liveLog,
    append,
    flush,
    clear,
  }
}
