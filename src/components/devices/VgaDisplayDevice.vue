<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  pixels?: number[]
  columns?: number
  rows?: number
  isOn?: boolean
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let imageData: ImageData | null = null
let drawFrameHandle: number | null = null

function channel3To8(value: number) {
  return Math.round((value / 0x7) * 255)
}

function channel2To8(value: number) {
  return Math.round((value / 0x3) * 255)
}

function ensureImageData(context: CanvasRenderingContext2D, columns: number, rows: number) {
  if (!imageData || imageData.width !== columns || imageData.height !== rows) {
    imageData = context.createImageData(columns, rows)
  }

  return imageData
}

function drawFrame() {
  drawFrameHandle = null

  const canvas = canvasRef.value
  if (!canvas) {
    return
  }

  const columns = Math.max(1, props.columns ?? 160)
  const rows = Math.max(1, props.rows ?? 120)
  if (canvas.width !== columns) {
    canvas.width = columns
  }
  if (canvas.height !== rows) {
    canvas.height = rows
  }

  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  const nextImage = ensureImageData(context, columns, rows)
  const total = columns * rows
  for (let index = 0; index < total; index += 1) {
    const encoded = props.pixels?.[index] ?? 0
    const imageOffset = index * 4
    nextImage.data[imageOffset] = channel3To8((encoded >> 5) & 0x7)
    nextImage.data[imageOffset + 1] = channel3To8((encoded >> 2) & 0x7)
    nextImage.data[imageOffset + 2] = channel2To8(encoded & 0x3)
    nextImage.data[imageOffset + 3] = 255
  }

  context.putImageData(nextImage, 0, 0)
}

function scheduleDrawFrame() {
  if (drawFrameHandle !== null) {
    return
  }

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    drawFrameHandle = window.requestAnimationFrame(() => {
      drawFrame()
    })
    return
  }

  drawFrame()
}

watch(
  () => [props.columns, props.rows, props.pixels, props.isOn],
  () => {
    scheduleDrawFrame()
  },
)

onMounted(() => {
  scheduleDrawFrame()
})

onBeforeUnmount(() => {
  if (drawFrameHandle !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(drawFrameHandle)
  }
  drawFrameHandle = null
})
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-black">
    <canvas
      ref="canvasRef"
      class="absolute inset-0 h-full w-full bg-black [image-rendering:pixelated]"
    />
    <div
      v-if="props.isOn"
      class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03)_0,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_4px)] opacity-15"
    />
  </div>
</template>
