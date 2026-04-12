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

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44
const RGB332_TO_RGBA = new Uint32Array(
  Array.from({ length: 256 }, (_, encoded) => {
    const red = Math.round((((encoded >> 5) & 0x7) / 0x7) * 255)
    const green = Math.round((((encoded >> 2) & 0x7) / 0x7) * 255)
    const blue = Math.round(((encoded & 0x3) / 0x3) * 255)
    return red | (green << 8) | (blue << 16) | (255 << 24)
  }),
)

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
  const encodedPixels = props.pixels ?? []

  if (LITTLE_ENDIAN) {
    const rgbaWords = new Uint32Array(
      nextImage.data.buffer,
      nextImage.data.byteOffset,
      nextImage.data.byteLength / 4,
    )

    for (let index = 0; index < total; index += 1) {
      rgbaWords[index] = RGB332_TO_RGBA[encodedPixels[index] ?? 0] ?? RGB332_TO_RGBA[0]
    }
  } else {
    for (let index = 0; index < total; index += 1) {
      const encoded = encodedPixels[index] ?? 0
      const imageOffset = index * 4
      nextImage.data[imageOffset] = Math.round((((encoded >> 5) & 0x7) / 0x7) * 255)
      nextImage.data[imageOffset + 1] = Math.round((((encoded >> 2) & 0x7) / 0x7) * 255)
      nextImage.data[imageOffset + 2] = Math.round(((encoded & 0x3) / 0x3) * 255)
      nextImage.data[imageOffset + 3] = 255
    }
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
