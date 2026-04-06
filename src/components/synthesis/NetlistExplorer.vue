<script setup lang="ts">
import type {
  ImplementationReportV1,
  SynthesisNetlistGraphChunkSummaryV1,
  SynthesisNetlistGraphChunkV1,
  SynthesisNetlistGraphNodeV1,
  SynthesisNetlistGraphOverviewV1,
  SynthesisNetlistGraphPortViewV1,
  SynthesisNetlistGraphSearchMatchV1,
  SynthesisReportV1,
} from '@/lib/hardware-client'
import type { NetlistLayoutRect, NetlistLayoutResult } from '@/lib/netlist-graph-layout'
import type { DeepReadonly } from 'vue'

import { LoaderCircle, LocateFixed, Search, X, ZoomIn, ZoomOut } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  loadSynthesisNetlistGraphChunk,
  prepareSynthesisNetlistGraph,
  searchSynthesisNetlistGraph,
} from '@/lib/hardware-client'
import {
  computeNetlistFocus,
  type NetlistFocusResult,
  type NetlistSelectionScope,
} from '@/lib/netlist-graph-focus'
import { computeNetlistAtlasLayout, computeNetlistChunkLayout } from '@/lib/netlist-graph-layout'
import {
  buildTimingSearchAliases,
  parseTimingReportPaths,
  type ParsedTimingPath,
  type ParsedTimingPathStep,
} from '@/lib/netlist-timing-path'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const MIN_SCALE = 0.04
const MAX_SCALE = 2.75
const MAX_ATLAS_EDGES = 720
const ATLAS_PORT_WIDTH = 168
const ATLAS_PORT_HEIGHT = 34
const ATLAS_PORT_GAP = 14
const ATLAS_PORT_MARGIN = 108

type CanvasEmphasis = 'default' | 'upstream' | 'downstream' | 'selected' | 'timing'
type ResolvedTimingPathStep = ParsedTimingPathStep & {
  match: SynthesisNetlistGraphSearchMatchV1 | null
}
type ResolvedTimingPath = Omit<ParsedTimingPath, 'steps'> & {
  steps: ResolvedTimingPathStep[]
  chunkIds: string[]
  nodeIds: string[]
}

const props = defineProps<{
  report: DeepReadonly<SynthesisReportV1> | null
  implementationReport?: DeepReadonly<ImplementationReportV1> | null
  busy?: boolean
}>()

const { t } = useI18n()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const viewportRef = ref<HTMLDivElement | null>(null)
const overview = ref<SynthesisNetlistGraphOverviewV1 | null>(null)
const activeChunkId = ref<string | null>(null)
const chunkCache = reactive<Record<string, SynthesisNetlistGraphChunkV1 | undefined>>({})
const mode = ref<'atlas' | 'chunk'>('atlas')
const searchQuery = ref('')
const searchResults = ref<SynthesisNetlistGraphSearchMatchV1[]>([])
const searchBusy = ref(false)
const viewerBusy = ref(false)
const errorMessage = ref('')
const selectedNodeId = ref<string | null>(null)
const selectionScope = ref<NetlistSelectionScope>('full')
const hoveredId = ref<string | null>(null)
const hoveredKind = ref<'chunk' | 'node' | null>(null)
const activeTimingPathId = ref<string | null>(null)
const timingBusy = ref(false)
const timingPathMatchMap = ref<Record<string, SynthesisNetlistGraphSearchMatchV1 | null>>({})
const layout = shallowRef<NetlistLayoutResult | null>(null)
const transform = reactive({
  x: 48,
  y: 48,
  scale: 1,
})
const dragState = reactive({
  active: false,
  moved: false,
  startClientX: 0,
  startClientY: 0,
  originX: 0,
  originY: 0,
})

const activeChunk = computed(() => {
  const chunkId = activeChunkId.value
  return chunkId ? (chunkCache[chunkId] ?? null) : null
})

const graphRequest = computed(() => {
  const report = props.report
  const artifacts = report?.artifacts
  const netlistJsonPath = artifacts?.netlist_json_path?.trim()
  if (!report?.success || !netlistJsonPath) {
    return null
  }

  return {
    top_module: report.top_module,
    netlist_json_path: netlistJsonPath,
    work_dir: artifacts?.work_dir ?? null,
    cache_dir: artifacts?.netlist_graph_cache_dir ?? null,
  }
})

const activeChunkSummary = computed(() => {
  const chunkId = activeChunkId.value
  return overview.value?.chunks.find((entry) => entry.chunk_id === chunkId) ?? null
})

const selectedNode = computed(() => {
  const chunk = activeChunk.value
  const nodeId = selectedNodeId.value
  return chunk?.nodes.find((node) => node.id === nodeId) ?? null
})

const selectedNodeProperties = computed(() => {
  const node = selectedNode.value
  if (!node) {
    return []
  }

  return node.properties.filter((property) => {
    if (!node.truth_table) {
      return true
    }

    const normalizedKey = property.key.toUpperCase()
    return normalizedKey !== 'INIT' && !normalizedKey.includes('TRUTH')
  })
})

const selectedNodePropertyRows = computed(() => {
  const node = selectedNode.value
  if (!node) {
    return []
  }

  const rows: Array<{ label: string; value: string; monospace?: boolean }> = [
    { label: t('name'), value: node.label },
    { label: t('kindLabel'), value: node.kind },
  ]

  if (node.cell_type) {
    rows.push({ label: t('typeLabel'), value: node.cell_type })
  }

  if (node.direction) {
    rows.push({ label: t('direction'), value: node.direction })
  }

  rows.push(
    { label: t('faninLabel'), value: formatCount(node.fanin) },
    { label: t('fanoutLabel'), value: formatCount(node.fanout) },
  )

  for (const property of selectedNodeProperties.value) {
    rows.push({
      label: property.key,
      value: property.value,
      monospace: true,
    })
  }

  if (node.truth_table) {
    rows.push({
      label: t('truthTable'),
      value: node.truth_table,
      monospace: true,
    })
  }

  return rows
})

const parsedTimingPaths = computed(() => {
  return parseTimingReportPaths(props.implementationReport?.timing_report ?? '')
})

const resolvedTimingPaths = computed<ResolvedTimingPath[]>(() => {
  return parsedTimingPaths.value.map((path) => {
    const steps = path.steps.map((step) => ({
      ...step,
      match: timingPathMatchMap.value[step.label] ?? null,
    }))

    return {
      ...path,
      steps,
      chunkIds: uniqueStringValues(steps.map((step) => step.match?.chunk_id ?? null)),
      nodeIds: uniqueStringValues(steps.map((step) => step.match?.node_id ?? null)),
    }
  })
})

const activeTimingPath = computed<ResolvedTimingPath | null>(() => {
  const pathId = activeTimingPathId.value
  return (
    resolvedTimingPaths.value.find((path) => path.id === pathId) ??
    resolvedTimingPaths.value[0] ??
    null
  )
})

const activeTimingChunkIds = computed(() => {
  return new Set(activeTimingPath.value?.chunkIds ?? [])
})

const activeTimingNodeIdsInChunk = computed(() => {
  const chunkId = activeChunkId.value
  if (!chunkId) {
    return new Set<string>()
  }

  const steps = activeTimingPath.value?.steps ?? []

  return new Set(
    steps
      .filter((step) => step.match?.chunk_id === chunkId && step.match.node_id)
      .map((step) => step.match?.node_id)
      .filter((nodeId): nodeId is string => !!nodeId),
  )
})

const activeTimingEdgeIdsInChunk = computed(() => {
  const chunk = activeChunk.value
  if (!chunk || activeTimingNodeIdsInChunk.value.size < 2) {
    return new Set<string>()
  }

  return new Set(
    chunk.edges
      .filter(
        (edge) =>
          activeTimingNodeIdsInChunk.value.has(edge.source_id) &&
          activeTimingNodeIdsInChunk.value.has(edge.target_id),
      )
      .map((edge) => edge.id),
  )
})

const sortedChunks = computed(() => {
  const chunks = overview.value?.chunks ?? []
  return [...chunks].sort((left, right) => {
    return (
      right.external_edge_count - left.external_edge_count ||
      right.node_count - left.node_count ||
      left.chunk_id.localeCompare(right.chunk_id)
    )
  })
})

const highFanoutNodes = computed(() => {
  const chunk = activeChunk.value
  if (!chunk) {
    return []
  }

  return [...chunk.nodes]
    .sort((left, right) => {
      return (
        right.fanout - left.fanout ||
        right.degree - left.degree ||
        left.label.localeCompare(right.label)
      )
    })
    .slice(0, 16)
})

const linkedChunks = computed(() => activeChunk.value?.linked_chunks ?? [])

const hasSearchQuery = computed(() => searchQuery.value.trim().length >= 2)

const chunkSummaryMap = computed(() => {
  return new Map((overview.value?.chunks ?? []).map((chunk) => [chunk.chunk_id, chunk]))
})

const relatedViewSummaries = computed(() => {
  return linkedChunks.value
    .map((linked) => ({
      linked,
      summary: chunkSummaryMap.value.get(linked.chunk_id) ?? null,
    }))
    .filter(
      (
        entry,
      ): entry is {
        linked: (typeof linkedChunks.value)[number]
        summary: SynthesisNetlistGraphChunkSummaryV1
      } => entry.summary !== null,
    )
})

const topModuleName = computed(() => overview.value?.top_module ?? props.report?.top_module ?? '')

const activeCanvasLabel = computed(() => {
  return mode.value === 'atlas' ? t('netlistAtlas') : getChunkDisplayTitle(activeChunkSummary.value)
})

const focusedChunkGraph = computed(() => {
  return computeNetlistFocus(activeChunk.value, selectedNodeId.value, selectionScope.value)
})

const isSelectionScoped = computed(() => {
  return mode.value === 'chunk' && selectionScope.value !== 'full' && !!selectedNodeId.value
})

const zoomPercent = computed(() => Math.round(transform.scale * 100))

let resizeObserver: ResizeObserver | null = null
let renderFrame = 0
let layoutRequestId = 0
let timingResolveRequestId = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(
  graphRequest,
  () => {
    void loadOverview()
  },
  { immediate: true },
)

watch(
  parsedTimingPaths,
  (paths) => {
    if (paths.length === 0) {
      activeTimingPathId.value = null
      return
    }

    if (!paths.some((path) => path.id === activeTimingPathId.value)) {
      activeTimingPathId.value = paths[0]?.id ?? null
    }
  },
  { immediate: true },
)

watch(
  () => [
    overview.value?.cache_dir ?? '',
    parsedTimingPaths.value
      .map((path) => `${path.id}:${path.steps.map((step) => step.label).join('>')}`)
      .join('|'),
  ],
  () => {
    void resolveTimingPathMatches()
  },
  { immediate: true },
)

watch(searchQuery, () => {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }

  const currentOverview = overview.value
  const query = searchQuery.value.trim()
  if (!currentOverview || query.length < 2) {
    searchBusy.value = false
    searchResults.value = []
    return
  }

  searchBusy.value = true
  searchTimer = setTimeout(async () => {
    try {
      const result = await searchSynthesisNetlistGraph({
        cache_dir: currentOverview.cache_dir,
        query,
        limit: 10,
      })
      searchResults.value = result.matches
    } catch {
      searchResults.value = []
    } finally {
      searchBusy.value = false
      searchTimer = null
    }
  }, 180)
})

watch(selectedNodeId, () => {
  if (!selectedNodeId.value) {
    selectionScope.value = 'full'
    return
  }

  if (mode.value === 'chunk' && selectionScope.value !== 'full') {
    void nextTick().then(() => {
      fitToView()
    })
  }
})

watch(
  () => [
    layout.value,
    transform.x,
    transform.y,
    transform.scale,
    hoveredId.value,
    selectedNodeId.value,
    activeTimingPathId.value,
    resolvedTimingPaths.value,
  ],
  () => {
    scheduleRender()
  },
  { deep: true },
)

watch(viewportRef, (element, previous) => {
  if (previous && resizeObserver) {
    resizeObserver.unobserve(previous)
  }
  if (element && resizeObserver) {
    resizeObserver.observe(element)
  }
})

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    scheduleRender()
  })

  if (viewportRef.value) {
    resizeObserver.observe(viewportRef.value)
  }
})

onUnmounted(() => {
  if (renderFrame) {
    cancelAnimationFrame(renderFrame)
  }
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  resizeObserver?.disconnect()
})

function resetExplorerState() {
  overview.value = null
  activeChunkId.value = null
  mode.value = 'atlas'
  searchQuery.value = ''
  searchResults.value = []
  selectedNodeId.value = null
  selectionScope.value = 'full'
  hoveredId.value = null
  hoveredKind.value = null
  layout.value = null
  errorMessage.value = ''
  timingBusy.value = false
  timingPathMatchMap.value = {}
  for (const key of Object.keys(chunkCache)) {
    delete chunkCache[key]
  }
}

async function loadOverview() {
  const request = graphRequest.value
  resetExplorerState()
  if (!request) {
    return
  }

  viewerBusy.value = true
  try {
    const nextOverview = await prepareSynthesisNetlistGraph(request)
    overview.value = nextOverview
    activeChunkId.value = pickDefaultChunkId(nextOverview)
    if (activeChunkId.value) {
      await ensureChunkLoaded(activeChunkId.value)
    }
    await updateLayout(true)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    viewerBusy.value = false
  }
}

function pickDefaultChunkId(currentOverview: SynthesisNetlistGraphOverviewV1) {
  const [firstChunk] = [...currentOverview.chunks].sort((left, right) => {
    return (
      right.port_count - left.port_count ||
      right.node_count - left.node_count ||
      left.chunk_id.localeCompare(right.chunk_id)
    )
  })

  return firstChunk?.chunk_id ?? null
}

async function ensureChunkLoaded(chunkId: string) {
  const currentOverview = overview.value
  if (!currentOverview) {
    return null
  }

  if (chunkCache[chunkId]) {
    return chunkCache[chunkId] ?? null
  }

  const chunk = await loadSynthesisNetlistGraphChunk({
    cache_dir: currentOverview.cache_dir,
    chunk_id: chunkId,
  })
  chunkCache[chunkId] = chunk
  return chunk
}

async function resolveTimingPathMatches() {
  const currentOverview = overview.value
  const requestId = ++timingResolveRequestId
  const labels = uniqueStringValues(
    parsedTimingPaths.value.flatMap((path) => path.steps.map((step) => step.label)),
  ).slice(0, 48)

  if (!currentOverview || labels.length === 0) {
    timingBusy.value = false
    timingPathMatchMap.value = {}
    return
  }

  timingBusy.value = true
  const nextMatchMap: Record<string, SynthesisNetlistGraphSearchMatchV1 | null> = {}

  await Promise.all(
    labels.map(async (label) => {
      const aliases = buildTimingSearchAliases(label, topModuleName.value).slice(0, 6)

      for (const alias of aliases) {
        try {
          const result = await searchSynthesisNetlistGraph({
            cache_dir: currentOverview.cache_dir,
            query: alias,
            limit: 8,
          })
          const match = pickBestTimingMatch(alias, result.matches)
          if (match) {
            nextMatchMap[label] = match
            return
          }
        } catch {
          continue
        }
      }

      nextMatchMap[label] = null
    }),
  )

  if (requestId !== timingResolveRequestId) {
    return
  }

  timingPathMatchMap.value = nextMatchMap
  timingBusy.value = false
}

async function updateLayout(fit = false) {
  const currentOverview = overview.value
  const requestId = ++layoutRequestId

  if (!currentOverview) {
    layout.value = null
    return
  }

  if (mode.value === 'atlas') {
    const nextLayout = await computeNetlistAtlasLayout(
      currentOverview.chunks,
      currentOverview.interconnects,
    )
    if (requestId !== layoutRequestId) {
      return
    }
    layout.value = nextLayout
    if (fit) {
      await nextTick()
      fitToView()
    }
    return
  }

  const chunkId = activeChunkId.value
  if (!chunkId) {
    layout.value = null
    return
  }

  const chunk = await ensureChunkLoaded(chunkId)
  if (!chunk || requestId !== layoutRequestId) {
    return
  }

  const nextLayout = await computeNetlistChunkLayout(chunk)
  if (requestId !== layoutRequestId) {
    return
  }
  layout.value = nextLayout
  if (fit) {
    await nextTick()
    fitToView()
  }
}

async function openChunk(chunkId: string) {
  activeChunkId.value = chunkId
  selectedNodeId.value = null
  selectionScope.value = 'full'
  mode.value = 'chunk'
  viewerBusy.value = true
  try {
    await updateLayout(true)
  } finally {
    viewerBusy.value = false
  }
}

async function showAtlas() {
  mode.value = 'atlas'
  selectedNodeId.value = null
  selectionScope.value = 'full'
  viewerBusy.value = true
  try {
    await updateLayout(true)
  } finally {
    viewerBusy.value = false
  }
}

function zoomBy(factor: number) {
  const viewport = viewportRef.value
  const currentLayout = layout.value
  if (!viewport || !currentLayout) {
    return
  }

  const centerX = viewport.clientWidth / 2
  const centerY = viewport.clientHeight / 2
  const worldX = (centerX - transform.x) / transform.scale
  const worldY = (centerY - transform.y) / transform.scale
  const nextScale = clamp(transform.scale * factor, MIN_SCALE, MAX_SCALE)

  transform.scale = nextScale
  transform.x = centerX - worldX * nextScale
  transform.y = centerY - worldY * nextScale
}

function fitToView() {
  const viewport = viewportRef.value
  const currentLayout = layout.value
  if (!viewport || !currentLayout) {
    return
  }

  const padding = 56
  const bounds = getRenderBounds(currentLayout)
  const availableWidth = Math.max(1, viewport.clientWidth - padding * 2)
  const availableHeight = Math.max(1, viewport.clientHeight - padding * 2)
  const scale = clamp(
    Math.min(
      availableWidth / Math.max(1, bounds.width),
      availableHeight / Math.max(1, bounds.height),
    ),
    MIN_SCALE,
    1.35,
  )

  transform.scale = scale
  transform.x = (viewport.clientWidth - bounds.width * scale) / 2 - bounds.minX * scale
  transform.y = (viewport.clientHeight - bounds.height * scale) / 2 - bounds.minY * scale
}

function scheduleRender() {
  if (renderFrame) {
    return
  }

  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0
    drawCanvas()
  })
}

function drawCanvas() {
  const canvas = canvasRef.value
  const viewport = viewportRef.value
  const currentLayout = layout.value
  if (!canvas || !viewport) {
    return
  }

  const width = Math.max(1, viewport.clientWidth)
  const height = Math.max(1, viewport.clientHeight)
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
  }

  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  drawBackdrop(context, width, height)

  if (!currentLayout) {
    return
  }

  context.save()
  context.translate(transform.x, transform.y)
  context.scale(transform.scale, transform.scale)

  if (mode.value === 'atlas' && overview.value) {
    drawAtlas(context, overview.value, currentLayout)
  } else if (mode.value === 'chunk' && activeChunk.value) {
    drawChunk(context, activeChunk.value, currentLayout)
  }

  context.restore()
}

function drawBackdrop(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = 'rgba(8, 15, 28, 0.92)'
  context.fillRect(0, 0, width, height)

  const gridStep = 40 * transform.scale
  if (gridStep < 10) {
    return
  }

  const offsetX = ((transform.x % gridStep) + gridStep) % gridStep
  const offsetY = ((transform.y % gridStep) + gridStep) % gridStep
  context.strokeStyle = 'rgba(148, 163, 184, 0.08)'
  context.lineWidth = 1

  for (let x = offsetX; x <= width; x += gridStep) {
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }

  for (let y = offsetY; y <= height; y += gridStep) {
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }
}

function drawAtlas(
  context: CanvasRenderingContext2D,
  currentOverview: SynthesisNetlistGraphOverviewV1,
  currentLayout: NetlistLayoutResult,
) {
  const focusChunkId = hoveredKind.value === 'chunk' ? hoveredId.value : null
  const portRects = getAtlasPortRects(currentOverview, currentLayout)
  const allEdges = [...currentOverview.interconnects].sort(
    (left, right) => right.edge_count - left.edge_count,
  )
  const visibleEdges =
    allEdges.length > MAX_ATLAS_EDGES && focusChunkId
      ? allEdges.filter(
          (edge) => edge.source_chunk_id === focusChunkId || edge.target_chunk_id === focusChunkId,
        )
      : allEdges.slice(0, MAX_ATLAS_EDGES)

  for (const edge of visibleEdges) {
    const source = currentLayout.positions[edge.source_chunk_id]
    const target = currentLayout.positions[edge.target_chunk_id]
    if (!source || !target) {
      continue
    }

    const isFocused =
      edge.source_chunk_id === focusChunkId ||
      edge.target_chunk_id === focusChunkId ||
      !focusChunkId
    const isTiming =
      activeTimingChunkIds.value.has(edge.source_chunk_id) &&
      activeTimingChunkIds.value.has(edge.target_chunk_id)
    drawConnection(
      context,
      source,
      target,
      edge.edge_count,
      isTiming ? 0.34 : isFocused ? 0.28 : 0.12,
      isTiming ? 'rgba(248, 113, 113, 0.34)' : undefined,
      isTiming ? 0.5 : 0,
    )
  }

  for (const portEntry of portRects) {
    const target = currentLayout.positions[portEntry.port.chunk_id]
    if (!target) {
      continue
    }

    const isFocused = !focusChunkId || portEntry.port.chunk_id === focusChunkId
    const isTiming = activeTimingChunkIds.value.has(portEntry.port.chunk_id)
    drawConnection(
      context,
      portEntry.rect,
      target,
      1,
      isTiming ? 0.28 : isFocused ? 0.22 : 0.1,
      isTiming
        ? 'rgba(248, 113, 113, 0.32)'
        : portEntry.port.direction === 'output'
          ? 'rgba(248, 250, 252, 0.32)'
          : 'rgba(96, 165, 250, 0.28)',
      isTiming ? 0.35 : 0,
    )
  }

  for (const chunk of currentOverview.chunks) {
    const rect = currentLayout.positions[chunk.chunk_id]
    if (!rect) {
      continue
    }
    const isHovered = hoveredKind.value === 'chunk' && hoveredId.value === chunk.chunk_id
    const isActive = activeChunkId.value === chunk.chunk_id
    const isTiming = activeTimingChunkIds.value.has(chunk.chunk_id)
    drawChunkCard(context, rect, chunk, isHovered, isActive, isTiming)
  }

  for (const portEntry of portRects) {
    const isFocused = !focusChunkId || portEntry.port.chunk_id === focusChunkId
    const isTiming = activeTimingChunkIds.value.has(portEntry.port.chunk_id)
    drawPortCard(context, portEntry.rect, portEntry.port, isFocused, isTiming)
  }
}

function drawChunk(
  context: CanvasRenderingContext2D,
  currentChunk: SynthesisNetlistGraphChunkV1,
  currentLayout: NetlistLayoutResult,
) {
  const focus = isSelectionScoped.value ? focusedChunkGraph.value : null

  for (const edge of currentChunk.edges) {
    if (focus && !focus.edgeIds.has(edge.id)) {
      continue
    }

    const source = currentLayout.positions[edge.source_id]
    const target = currentLayout.positions[edge.target_id]
    if (!source || !target) {
      continue
    }

    const emphasis = getEdgeEmphasis(edge.id, edge.source_id, edge.target_id, focus)
    drawConnection(
      context,
      source,
      target,
      edge.bit_width,
      getEdgeOpacity(emphasis),
      getEdgeStrokeStyle(emphasis),
      getEdgeWidthBoost(emphasis),
    )
  }

  for (const node of currentChunk.nodes) {
    if (focus && !focus.nodeIds.has(node.id)) {
      continue
    }

    const rect = currentLayout.positions[node.id]
    if (!rect) {
      continue
    }
    const isHovered = hoveredKind.value === 'node' && hoveredId.value === node.id
    const isSelected = selectedNodeId.value === node.id
    const emphasis = getNodeEmphasis(node.id, focus)
    drawNodeCard(context, rect, node, isHovered, isSelected, emphasis)
  }
}

function drawConnection(
  context: CanvasRenderingContext2D,
  source: NetlistLayoutRect,
  target: NetlistLayoutRect,
  weight: number,
  opacity: number,
  strokeStyle = `rgba(125, 211, 252, ${opacity})`,
  widthBoost = 0,
) {
  const sourceOnLeft = source.x <= target.x
  const startX = sourceOnLeft ? source.x + source.width : source.x
  const endX = sourceOnLeft ? target.x : target.x + target.width
  const startY = source.y + source.height / 2
  const endY = target.y + target.height / 2
  const controlX = (startX + endX) / 2

  context.beginPath()
  context.moveTo(startX, startY)
  context.bezierCurveTo(controlX, startY, controlX, endY, endX, endY)
  context.strokeStyle = strokeStyle
  context.lineWidth = Math.min(3.8, 1 + Math.log10(weight + 1) + widthBoost)
  context.stroke()
}

function drawChunkCard(
  context: CanvasRenderingContext2D,
  rect: NetlistLayoutRect,
  chunk: SynthesisNetlistGraphChunkSummaryV1,
  isHovered: boolean,
  isActive: boolean,
  isTiming: boolean,
) {
  context.save()
  context.fillStyle = isActive
    ? 'rgba(15, 118, 110, 0.92)'
    : isTiming
      ? 'rgba(73, 26, 24, 0.92)'
      : 'rgba(15, 23, 42, 0.88)'
  roundRect(context, rect.x, rect.y, rect.width, rect.height, 18)
  context.fill()

  context.strokeStyle = isHovered
    ? 'rgba(125, 211, 252, 0.95)'
    : isActive
      ? 'rgba(153, 246, 228, 0.86)'
      : isTiming
        ? 'rgba(248, 113, 113, 0.82)'
        : 'rgba(148, 163, 184, 0.32)'
  context.lineWidth = isHovered || isActive ? 2.4 : 1.3
  context.stroke()

  context.fillStyle = 'rgba(226, 232, 240, 0.94)'
  context.font = '600 14px sans-serif'
  context.fillText(getChunkDisplayTitle(chunk), rect.x + 16, rect.y + 26, rect.width - 88)

  context.fillStyle = 'rgba(148, 163, 184, 0.88)'
  context.font = '500 11px sans-serif'
  drawTextRows(context, chunk.prominent_labels, rect.x + 16, rect.y + 52, rect.width - 32, 16, 4)

  if (isTiming) {
    context.fillStyle = 'rgba(239, 68, 68, 0.2)'
    roundRect(context, rect.x + rect.width - 72, rect.y + rect.height - 34, 56, 20, 10)
    context.fill()
    context.fillStyle = 'rgba(254, 226, 226, 0.94)'
    context.font = '600 10px sans-serif'
    context.fillText('STA', rect.x + rect.width - 48, rect.y + rect.height - 20)
  }
  context.restore()
}

function drawPortCard(
  context: CanvasRenderingContext2D,
  rect: NetlistLayoutRect,
  port: SynthesisNetlistGraphPortViewV1,
  isFocused: boolean,
  isTiming: boolean,
) {
  context.save()
  context.fillStyle = isTiming
    ? 'rgba(73, 26, 24, 0.94)'
    : port.direction === 'output'
      ? isFocused
        ? 'rgba(30, 41, 59, 0.96)'
        : 'rgba(15, 23, 42, 0.9)'
      : isFocused
        ? 'rgba(8, 47, 73, 0.94)'
        : 'rgba(12, 30, 48, 0.9)'
  roundRect(context, rect.x, rect.y, rect.width, rect.height, 12)
  context.fill()

  context.strokeStyle = isTiming
    ? 'rgba(248, 113, 113, 0.82)'
    : isFocused
      ? 'rgba(125, 211, 252, 0.9)'
      : 'rgba(148, 163, 184, 0.28)'
  context.lineWidth = isFocused ? 1.8 : 1.2
  context.stroke()

  context.fillStyle = 'rgba(226, 232, 240, 0.96)'
  context.font = '600 12px sans-serif'
  context.fillText(port.name, rect.x + 12, rect.y + 15, rect.width - 24)

  context.fillStyle = 'rgba(148, 163, 184, 0.9)'
  context.font = '500 10px sans-serif'
  const meta = [port.direction, port.width].filter(Boolean).join(' ')
  context.fillText(meta, rect.x + 12, rect.y + 28, rect.width - 24)
  context.restore()
}

function drawNodeCard(
  context: CanvasRenderingContext2D,
  rect: NetlistLayoutRect,
  node: SynthesisNetlistGraphNodeV1,
  isHovered: boolean,
  isSelected: boolean,
  emphasis: CanvasEmphasis,
) {
  context.save()
  const accentColor = getNodeAccentStyle(node, emphasis)
  context.fillStyle = getNodeFillStyle(node, emphasis)
  if (node.kind === 'port') {
    tracePortShape(context, rect, node.direction)
    context.fill()
  } else {
    roundRect(context, rect.x, rect.y, rect.width, rect.height, 10)
    context.fill()

    context.fillStyle = 'rgba(255, 255, 255, 0.04)'
    roundRect(context, rect.x + 8, rect.y + 8, rect.width - 16, 16, 8)
    context.fill()
  }

  if (node.kind !== 'port') {
    context.fillStyle = accentColor
    roundRect(context, rect.x + 1, rect.y + 1, 6, rect.height - 2, 5)
    context.fill()
  }

  context.strokeStyle = isHovered ? 'rgba(226, 232, 240, 0.98)' : accentColor
  context.lineWidth = isHovered || isSelected ? 2.2 : 1.2
  if (node.kind === 'port') {
    tracePortShape(context, rect, node.direction)
    context.stroke()
  } else {
    roundRect(context, rect.x, rect.y, rect.width, rect.height, 10)
    context.stroke()
  }

  drawNodePins(context, rect, node, accentColor)
  drawNodeTypeBadge(context, rect, node, accentColor)

  context.fillStyle = 'rgba(226, 232, 240, 0.96)'
  context.font = '600 13px sans-serif'
  context.fillText(node.label, rect.x + 14, rect.y + 22, rect.width - 82)

  context.fillStyle = 'rgba(148, 163, 184, 0.92)'
  context.font = '500 11px sans-serif'
  const subtitle = node.kind === 'port' ? (node.direction ?? 'port') : (node.cell_type ?? 'cell')
  context.fillText(subtitle, rect.x + 14, rect.y + 40, rect.width - 28)

  context.fillStyle = 'rgba(186, 230, 253, 0.92)'
  context.fillText(`fanout ${node.fanout}`, rect.x + 14, rect.y + 56)
  if (node.external_connection_count > 0) {
    context.fillText(`x ${node.external_connection_count}`, rect.x + rect.width - 44, rect.y + 56)
  }
  context.restore()
}

function tracePortShape(
  context: CanvasRenderingContext2D,
  rect: NetlistLayoutRect,
  direction: string | null,
) {
  const x = rect.x
  const y = rect.y
  const width = rect.width
  const height = rect.height
  const tip = 14

  context.beginPath()
  if (direction === 'output') {
    context.moveTo(x, y)
    context.lineTo(x + width - tip, y)
    context.lineTo(x + width, y + height / 2)
    context.lineTo(x + width - tip, y + height)
    context.lineTo(x, y + height)
  } else {
    context.moveTo(x + tip, y)
    context.lineTo(x + width, y)
    context.lineTo(x + width, y + height)
    context.lineTo(x + tip, y + height)
    context.lineTo(x, y + height / 2)
  }
  context.closePath()
}

function drawNodeTypeBadge(
  context: CanvasRenderingContext2D,
  rect: NetlistLayoutRect,
  node: SynthesisNetlistGraphNodeV1,
  accentColor: string,
) {
  const badgeLabel = (node.kind === 'port' ? node.direction : node.cell_type || node.kind || '')
    ?.toString()
    .slice(0, 8)
    .toUpperCase()
  if (!badgeLabel) {
    return
  }

  const badgeWidth = Math.max(34, Math.min(58, badgeLabel.length * 7 + 12))
  context.fillStyle = 'rgba(2, 6, 23, 0.54)'
  roundRect(context, rect.x + rect.width - badgeWidth - 10, rect.y + 8, badgeWidth, 16, 8)
  context.fill()
  context.strokeStyle = accentColor
  context.lineWidth = 1
  context.stroke()
  context.fillStyle = 'rgba(226, 232, 240, 0.92)'
  context.font = '600 9px sans-serif'
  context.fillText(badgeLabel, rect.x + rect.width - badgeWidth - 4, rect.y + 19, badgeWidth - 8)
}

function getNodeEmphasis(nodeId: string, focus: NetlistFocusResult | null): CanvasEmphasis {
  if (selectedNodeId.value === nodeId) {
    return 'selected'
  }

  if (focus) {
    if (focus.upstreamNodeIds.has(nodeId)) {
      return 'upstream'
    }

    if (focus.downstreamNodeIds.has(nodeId)) {
      return 'downstream'
    }
  }

  if (activeTimingNodeIdsInChunk.value.has(nodeId)) {
    return 'timing'
  }

  return 'default'
}

function getEdgeEmphasis(
  edgeId: string,
  sourceId: string,
  targetId: string,
  focus: NetlistFocusResult | null,
): CanvasEmphasis {
  if (selectedNodeId.value === sourceId) {
    return 'downstream'
  }

  if (selectedNodeId.value === targetId) {
    return 'upstream'
  }

  if (focus) {
    if (focus.upstreamEdgeIds.has(edgeId)) {
      return 'upstream'
    }

    if (focus.downstreamEdgeIds.has(edgeId)) {
      return 'downstream'
    }
  }

  if (activeTimingEdgeIdsInChunk.value.has(edgeId)) {
    return 'timing'
  }

  return 'default'
}

function getNodeFillStyle(node: SynthesisNetlistGraphNodeV1, emphasis: CanvasEmphasis) {
  if (emphasis === 'selected') {
    return 'rgba(16, 57, 73, 0.98)'
  }

  if (emphasis === 'upstream') {
    return 'rgba(12, 43, 78, 0.96)'
  }

  if (emphasis === 'downstream') {
    return 'rgba(72, 44, 17, 0.96)'
  }

  if (emphasis === 'timing') {
    return 'rgba(74, 26, 27, 0.96)'
  }

  return node.kind === 'port' ? 'rgba(8, 47, 73, 0.96)' : 'rgba(15, 23, 42, 0.92)'
}

function getNodeAccentStyle(node: SynthesisNetlistGraphNodeV1, emphasis: CanvasEmphasis) {
  if (emphasis === 'selected') {
    return 'rgba(94, 234, 212, 0.96)'
  }

  if (emphasis === 'upstream') {
    return 'rgba(96, 165, 250, 0.96)'
  }

  if (emphasis === 'downstream') {
    return 'rgba(251, 191, 36, 0.96)'
  }

  if (emphasis === 'timing') {
    return 'rgba(248, 113, 113, 0.92)'
  }

  return node.kind === 'port' ? 'rgba(125, 211, 252, 0.9)' : 'rgba(148, 163, 184, 0.34)'
}

function getEdgeStrokeStyle(emphasis: CanvasEmphasis) {
  if (emphasis === 'selected') {
    return 'rgba(94, 234, 212, 0.4)'
  }

  if (emphasis === 'upstream') {
    return 'rgba(96, 165, 250, 0.42)'
  }

  if (emphasis === 'downstream') {
    return 'rgba(251, 191, 36, 0.42)'
  }

  if (emphasis === 'timing') {
    return 'rgba(248, 113, 113, 0.42)'
  }

  return 'rgba(125, 211, 252, 0.14)'
}

function getEdgeOpacity(emphasis: CanvasEmphasis) {
  if (emphasis === 'default') {
    return 0.14
  }

  return emphasis === 'selected' ? 0.46 : 0.42
}

function getEdgeWidthBoost(emphasis: CanvasEmphasis) {
  if (emphasis === 'default') {
    return 0
  }

  return emphasis === 'selected' ? 1 : 0.55
}

function drawNodePins(
  context: CanvasRenderingContext2D,
  rect: NetlistLayoutRect,
  node: SynthesisNetlistGraphNodeV1,
  accentColor: string,
) {
  const midY = rect.y + rect.height / 2

  context.strokeStyle = accentColor
  context.lineWidth = 1.4

  if (node.direction !== 'output') {
    context.beginPath()
    context.moveTo(rect.x - 6, midY)
    context.lineTo(rect.x, midY)
    context.stroke()
  }

  if (node.direction !== 'input') {
    context.beginPath()
    context.moveTo(rect.x + rect.width, midY)
    context.lineTo(rect.x + rect.width + 6, midY)
    context.stroke()
  }
}

function drawTextRows(
  context: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  lines.slice(0, maxLines).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight, maxWidth)
  })
}

function getRenderBounds(currentLayout: NetlistLayoutResult) {
  if (mode.value === 'chunk' && isSelectionScoped.value) {
    const nodeRects = [...focusedChunkGraph.value.nodeIds]
      .map((nodeId) => currentLayout.positions[nodeId])
      .filter((rect): rect is NetlistLayoutRect => rect !== undefined)

    if (nodeRects.length > 0) {
      const minX = Math.min(...nodeRects.map((rect) => rect.x))
      const minY = Math.min(...nodeRects.map((rect) => rect.y))
      const maxX = Math.max(...nodeRects.map((rect) => rect.x + rect.width))
      const maxY = Math.max(...nodeRects.map((rect) => rect.y + rect.height))

      return {
        minX,
        minY,
        width: maxX - minX,
        height: maxY - minY,
      }
    }
  }

  if (mode.value !== 'atlas' || !overview.value) {
    return {
      minX: 0,
      minY: 0,
      width: currentLayout.bounds.width,
      height: currentLayout.bounds.height,
    }
  }

  const portRects = getAtlasPortRects(overview.value, currentLayout).map((entry) => entry.rect)
  let minX = 0
  let minY = 0
  let maxX = currentLayout.bounds.width
  let maxY = currentLayout.bounds.height

  for (const rect of portRects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function getAtlasPortRects(
  currentOverview: SynthesisNetlistGraphOverviewV1,
  currentLayout: NetlistLayoutResult,
) {
  const inputs = currentOverview.top_port_views.filter((port) => port.direction === 'input')
  const outputs = currentOverview.top_port_views.filter((port) => port.direction === 'output')
  const inouts = currentOverview.top_port_views.filter(
    (port) => port.direction !== 'input' && port.direction !== 'output',
  )

  return [
    ...placeAtlasPorts(inputs, currentLayout, 'left'),
    ...placeAtlasPorts(outputs, currentLayout, 'right'),
    ...placeAtlasPorts(inouts, currentLayout, 'top'),
  ]
}

function placeAtlasPorts(
  ports: SynthesisNetlistGraphPortViewV1[],
  currentLayout: NetlistLayoutResult,
  side: 'left' | 'right' | 'top',
) {
  const sortedPorts = [...ports].sort((left, right) => {
    const leftRect = currentLayout.positions[left.chunk_id]
    const rightRect = currentLayout.positions[right.chunk_id]
    const leftY = leftRect ? leftRect.y + leftRect.height / 2 : 0
    const rightY = rightRect ? rightRect.y + rightRect.height / 2 : 0
    return leftY - rightY || left.name.localeCompare(right.name)
  })

  const rects: Array<{ port: SynthesisNetlistGraphPortViewV1; rect: NetlistLayoutRect }> = []
  let cursorY = 0
  let cursorX = 0

  sortedPorts.forEach((port, index) => {
    const target = currentLayout.positions[port.chunk_id]
    if (!target) {
      return
    }

    if (side === 'top') {
      const x = cursorX
      cursorX += ATLAS_PORT_WIDTH + ATLAS_PORT_GAP
      rects.push({
        port,
        rect: {
          x,
          y: -ATLAS_PORT_HEIGHT - ATLAS_PORT_MARGIN,
          width: ATLAS_PORT_WIDTH,
          height: ATLAS_PORT_HEIGHT,
        },
      })
      return
    }

    const preferredY = target.y + target.height / 2 - ATLAS_PORT_HEIGHT / 2
    const y = index === 0 ? Math.max(0, preferredY) : Math.max(cursorY, preferredY)
    cursorY = y + ATLAS_PORT_HEIGHT + ATLAS_PORT_GAP

    rects.push({
      port,
      rect: {
        x:
          side === 'left'
            ? -ATLAS_PORT_WIDTH - ATLAS_PORT_MARGIN
            : currentLayout.bounds.width + ATLAS_PORT_MARGIN,
        y,
        width: ATLAS_PORT_WIDTH,
        height: ATLAS_PORT_HEIGHT,
      },
    })
  })

  return rects
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

function screenToWorld(clientX: number, clientY: number) {
  const canvas = canvasRef.value
  if (!canvas) {
    return { x: 0, y: 0 }
  }

  const rect = canvas.getBoundingClientRect()
  return {
    x: (clientX - rect.left - transform.x) / transform.scale,
    y: (clientY - rect.top - transform.y) / transform.scale,
  }
}

function hitTest(clientX: number, clientY: number) {
  const currentLayout = layout.value
  if (!currentLayout) {
    return null
  }

  const point = screenToWorld(clientX, clientY)
  if (mode.value === 'atlas') {
    const chunks = overview.value?.chunks ?? []
    for (let index = chunks.length - 1; index >= 0; index -= 1) {
      const chunk = chunks[index]
      const rect = currentLayout.positions[chunk.chunk_id]
      if (!rect) {
        continue
      }
      if (containsPoint(rect, point.x, point.y)) {
        return { id: chunk.chunk_id, kind: 'chunk' as const }
      }
    }
    return null
  }

  const nodes = activeChunk.value?.nodes ?? []
  const focus = isSelectionScoped.value ? focusedChunkGraph.value : null
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (focus && !focus.nodeIds.has(node.id)) {
      continue
    }
    const rect = currentLayout.positions[node.id]
    if (!rect) {
      continue
    }
    if (containsPoint(rect, point.x, point.y)) {
      return { id: node.id, kind: 'node' as const }
    }
  }

  return null
}

function containsPoint(rect: NetlistLayoutRect, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

function handlePointerDown(event: PointerEvent) {
  dragState.active = true
  dragState.moved = false
  dragState.startClientX = event.clientX
  dragState.startClientY = event.clientY
  dragState.originX = transform.x
  dragState.originY = transform.y
  canvasRef.value?.setPointerCapture(event.pointerId)
}

function handlePointerMove(event: PointerEvent) {
  if (dragState.active) {
    const deltaX = event.clientX - dragState.startClientX
    const deltaY = event.clientY - dragState.startClientY
    dragState.moved = dragState.moved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3
    transform.x = dragState.originX + deltaX
    transform.y = dragState.originY + deltaY
    return
  }

  const hit = hitTest(event.clientX, event.clientY)
  hoveredId.value = hit?.id ?? null
  hoveredKind.value = hit?.kind ?? null
}

function handlePointerUp(event: PointerEvent) {
  canvasRef.value?.releasePointerCapture(event.pointerId)
  const hit = hitTest(event.clientX, event.clientY)
  if (!dragState.moved && hit) {
    if (hit.kind === 'chunk') {
      void openChunk(hit.id)
    } else {
      selectedNodeId.value = hit.id
    }
  }
  dragState.active = false
  dragState.moved = false
}

function handlePointerLeave() {
  hoveredId.value = null
  hoveredKind.value = null
}

function handleWheel(event: WheelEvent) {
  event.preventDefault()
  const viewport = viewportRef.value
  if (!viewport) {
    return
  }

  const nextScale = clamp(transform.scale * Math.exp(-event.deltaY * 0.0012), MIN_SCALE, MAX_SCALE)
  const world = screenToWorld(event.clientX, event.clientY)
  const rect = viewport.getBoundingClientRect()
  const anchorX = event.clientX - rect.left
  const anchorY = event.clientY - rect.top

  transform.scale = nextScale
  transform.x = anchorX - world.x * nextScale
  transform.y = anchorY - world.y * nextScale
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatCount(value: number) {
  return value.toLocaleString()
}

function uniqueStringValues(values: Array<string | null | undefined>) {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue
    }

    seen.add(value)
    result.push(value)
  }

  return result
}

function normalizeSearchLabel(value: string) {
  return value.trim().toLowerCase()
}

function pickBestTimingMatch(
  label: string,
  matches: SynthesisNetlistGraphSearchMatchV1[],
): SynthesisNetlistGraphSearchMatchV1 | null {
  const normalizedLabel = normalizeSearchLabel(label)

  return (
    matches.find(
      (match) => match.node_id !== null && normalizeSearchLabel(match.label) === normalizedLabel,
    ) ??
    matches.find((match) => normalizeSearchLabel(match.label) === normalizedLabel) ??
    matches.find((match) => match.node_id !== null) ??
    matches[0] ??
    null
  )
}

async function applySelectionScope(nextScope: NetlistSelectionScope) {
  if (nextScope !== 'full' && !selectedNode.value) {
    return
  }

  selectionScope.value = nextScope
  await nextTick()
  fitToView()
}

function centerOnRect(rect: NetlistLayoutRect, minScale = 0.48, maxScale = 1.12) {
  const viewport = viewportRef.value
  if (!viewport) {
    return
  }

  const nextScale = clamp(Math.max(transform.scale, minScale), MIN_SCALE, maxScale)
  transform.scale = nextScale
  transform.x = viewport.clientWidth / 2 - (rect.x + rect.width / 2) * nextScale
  transform.y = viewport.clientHeight / 2 - (rect.y + rect.height / 2) * nextScale
}

async function focusNode(nodeId: string) {
  const currentLayout = layout.value
  selectedNodeId.value = nodeId

  if (!currentLayout) {
    return
  }

  await nextTick()
  const rect = currentLayout.positions[nodeId]
  if (!rect) {
    return
  }

  centerOnRect(rect)
}

function selectTimingPath(pathId: string) {
  activeTimingPathId.value = pathId
}

function clearSelection() {
  selectedNodeId.value = null
  selectionScope.value = 'full'
}

async function openTimingPathStep(step: ResolvedTimingPathStep) {
  if (!step.match?.chunk_id) {
    return
  }

  await openChunk(step.match.chunk_id)
  if (step.match.node_id) {
    await focusNode(step.match.node_id)
  }
}

function getChunkDisplayTitle(chunk: SynthesisNetlistGraphChunkSummaryV1 | null | undefined) {
  if (!chunk) {
    return t('netlistChunk')
  }

  const descriptiveLabels = chunk.prominent_labels
    .filter((label) => label.trim().length > 0 && !/\sx\d+$/.test(label))
    .slice(0, 2)
  if (descriptiveLabels.length > 0) {
    return descriptiveLabels.join(' / ')
  }

  if (chunk.prominent_labels.length > 0) {
    return chunk.prominent_labels.slice(0, 2).join(' / ')
  }

  const sortedIndex = sortedChunks.value.findIndex((entry) => entry.chunk_id === chunk.chunk_id)
  return `${t('netlistChunk')} ${sortedIndex >= 0 ? sortedIndex + 1 : ''}`.trim()
}

function getChunkDisplayTitleById(chunkId: string) {
  return getChunkDisplayTitle(chunkSummaryMap.value.get(chunkId))
}

function setHovered(kind: 'chunk' | 'node', id: string) {
  hoveredKind.value = kind
  hoveredId.value = id
}

function clearHovered(kind?: 'chunk' | 'node') {
  if (kind && hoveredKind.value !== kind) {
    return
  }

  hoveredId.value = null
  hoveredKind.value = null
}

async function openSearchMatch(match: SynthesisNetlistGraphSearchMatchV1) {
  await openChunk(match.chunk_id)
  if (match.node_id) {
    await focusNode(match.node_id)
  }
  searchResults.value = []
}
</script>

<template>
  <ResizablePanelGroup direction="horizontal" class="h-full overflow-hidden bg-background">
    <ResizablePanel :default-size="22" :min-size="16" :max-size="32" class="border-r bg-muted/10">
      <div class="flex h-full min-h-0 flex-col">
        <div class="border-b border-border/60 bg-background/70 px-3 py-3">
          <div class="space-y-3">
            <div class="relative">
              <Search
                class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                v-model="searchQuery"
                class="border-border/60 bg-background pl-9"
                :placeholder="t('netlistExplorerSearchPlaceholder')"
              />
            </div>

            <div class="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="flex-1 gap-1.5 border-border/60 bg-background"
                @click="fitToView"
              >
                <LocateFixed class="h-4 w-4" />
                {{ t('fitView') }}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                class="h-8 w-8 border-border/60 bg-background"
                @click="zoomBy(0.84)"
              >
                <ZoomOut class="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                class="h-8 w-8 border-border/60 bg-background"
                @click="zoomBy(1.18)"
              >
                <ZoomIn class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <ScrollArea class="flex-1">
          <div class="py-2">
            <section v-if="hasSearchQuery" class="border-b border-border/60 px-3 py-3">
              <div class="mb-2 flex items-center justify-between">
                <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {{ t('searchResults') }}
                </div>
                <span v-if="searchBusy" class="text-[11px] text-muted-foreground">
                  {{ t('netlistExplorerLoading') }}
                </span>
              </div>

              <div v-if="searchResults.length > 0" class="space-y-1">
                <button
                  v-for="match in searchResults"
                  :key="`${match.kind}:${match.label}:${match.chunk_id}`"
                  type="button"
                  class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50"
                  @click="openSearchMatch(match)"
                  @mouseenter="setHovered('chunk', match.chunk_id)"
                  @mouseleave="clearHovered('chunk')"
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{{ match.label }}</div>
                    <div class="mt-0.5 truncate text-xs text-muted-foreground">
                      {{ getChunkDisplayTitleById(match.chunk_id) }}
                    </div>
                    <div class="mt-0.5 text-xs text-muted-foreground">{{ match.detail }}</div>
                  </div>
                </button>
              </div>

              <div v-else-if="!searchBusy" class="px-2 py-2 text-sm text-muted-foreground">
                {{ t('noNetlistSearchResults') }}
              </div>
            </section>

            <section v-if="resolvedTimingPaths.length" class="border-b border-border/60 px-3 py-3">
              <div class="mb-2 flex items-center justify-between">
                <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {{ t('timingPaths') }}
                </div>
                <span v-if="timingBusy" class="text-[11px] text-muted-foreground">
                  {{ t('netlistExplorerLoading') }}
                </span>
              </div>

              <div class="space-y-1">
                <button
                  v-for="path in resolvedTimingPaths"
                  :key="path.id"
                  type="button"
                  :class="
                    cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
                      activeTimingPath?.id === path.id
                        ? 'bg-red-500/10 text-red-600'
                        : 'hover:bg-muted/50',
                    )
                  "
                  @click="selectTimingPath(path.id)"
                >
                  <span
                    class="mt-1 h-2 w-2 shrink-0 rounded-full"
                    :class="
                      activeTimingPath?.id === path.id ? 'bg-red-500' : 'bg-muted-foreground/30'
                    "
                  ></span>

                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{{ path.title }}</div>
                    <div
                      class="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]"
                      :class="
                        activeTimingPath?.id === path.id
                          ? 'text-red-500/80'
                          : 'text-muted-foreground'
                      "
                    >
                      <span v-if="path.slackText">{{ t('slackNs') }} {{ path.slackText }}</span>
                      <span>{{ formatCount(path.steps.length) }} {{ t('timingSteps') }}</span>
                    </div>
                  </div>
                </button>
              </div>

              <div v-if="activeTimingPath" class="mt-2 ml-4 border-l border-border/50 pl-2">
                <div
                  class="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {{ t('timingPathSteps') }}
                </div>

                <button
                  v-for="step in activeTimingPath.steps"
                  :key="`${activeTimingPath.id}:${step.label}`"
                  type="button"
                  :class="
                    cn(
                      'flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors',
                      step.match?.node_id &&
                        step.match.chunk_id === activeChunkId &&
                        selectedNodeId === step.match.node_id
                        ? 'bg-red-500/10 text-red-600'
                        : 'hover:bg-muted/50',
                    )
                  "
                  @click="void openTimingPathStep(step)"
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-medium">{{ step.label }}</div>
                    <div class="mt-0.5 truncate text-xs text-muted-foreground">
                      {{
                        step.match
                          ? getChunkDisplayTitleById(step.match.chunk_id)
                          : t('timingStepUnresolved')
                      }}
                    </div>
                  </div>
                </button>
              </div>
            </section>

            <section class="px-2 py-2">
              <div class="flex items-center gap-2 px-2 py-2 text-sm font-medium">
                <span class="truncate">{{ t('topModuleHint', { name: topModuleName }) }}</span>
                <Badge v-if="viewerBusy" variant="outline" class="ml-auto h-5 text-[10px]">
                  <LoaderCircle class="mr-1 h-3 w-3 animate-spin" />
                  {{ t('netlistExplorerLoading') }}
                </Badge>
              </div>

              <div class="mt-1 ml-4 border-l pl-2">
                <button
                  type="button"
                  :class="
                    cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                      mode === 'atlas' ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50',
                    )
                  "
                  @click="showAtlas"
                >
                  <span
                    class="mt-1 h-2 w-2 shrink-0 rounded-full"
                    :class="mode === 'atlas' ? 'bg-primary' : 'bg-muted-foreground/30'"
                  ></span>

                  <div class="min-w-0 flex-1">
                    <div class="font-medium">{{ t('netlistAtlas') }}</div>
                    <div
                      class="mt-0.5 text-[11px]"
                      :class="mode === 'atlas' ? 'text-primary/75' : 'text-muted-foreground'"
                    >
                      {{ t('netlistViewerHint') }}
                    </div>
                  </div>
                </button>

                <div class="mt-1 ml-4 border-l pl-2">
                  <button
                    v-for="chunk in sortedChunks"
                    :key="chunk.chunk_id"
                    type="button"
                    :class="
                      cn(
                        'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                        activeChunkId === chunk.chunk_id && mode === 'chunk'
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted/50',
                        hoveredKind === 'chunk' &&
                          hoveredId === chunk.chunk_id &&
                          !(activeChunkId === chunk.chunk_id && mode === 'chunk') &&
                          'bg-muted/50',
                      )
                    "
                    @click="openChunk(chunk.chunk_id)"
                    @mouseenter="setHovered('chunk', chunk.chunk_id)"
                    @mouseleave="clearHovered('chunk')"
                  >
                    <span
                      class="mt-1 h-2 w-2 shrink-0 rounded-full"
                      :class="
                        activeChunkId === chunk.chunk_id && mode === 'chunk'
                          ? 'bg-primary'
                          : activeChunkId === chunk.chunk_id
                            ? 'bg-primary/50'
                            : 'bg-muted-foreground/30'
                      "
                    ></span>

                    <div class="min-w-0 flex-1">
                      <div class="truncate font-medium">{{ getChunkDisplayTitle(chunk) }}</div>
                      <div
                        class="mt-0.5 truncate text-[11px]"
                        :class="
                          activeChunkId === chunk.chunk_id && mode === 'chunk'
                            ? 'text-primary/70'
                            : 'text-muted-foreground'
                        "
                      >
                        {{ chunk.prominent_labels.slice(0, 3).join(' · ') || '-' }}
                      </div>
                    </div>
                  </button>

                  <div
                    v-if="mode === 'chunk' && activeChunkSummary"
                    class="mt-1 ml-4 border-l border-border/50 pl-2"
                  >
                    <div
                      class="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      {{ t('netlistChunk') }}
                    </div>

                    <div v-if="selectedNode" class="px-2 py-2">
                      <div
                        class="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {{ t('selectedNode') }}
                      </div>
                      <div class="mt-1 text-sm font-medium">{{ selectedNode.label }}</div>
                      <div class="mt-0.5 text-xs text-muted-foreground">
                        {{ selectedNode.kind }} -
                        {{ selectedNode.cell_type || selectedNode.direction || 'node' }}
                      </div>

                      <div class="mt-2 flex flex-wrap gap-1">
                        <Button
                          type="button"
                          size="sm"
                          :variant="selectionScope === 'full' ? 'default' : 'outline'"
                          class="h-7 px-2 text-[11px]"
                          @click="applySelectionScope('full')"
                        >
                          {{ t('showAll') }}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          :variant="selectionScope === 'fanin' ? 'default' : 'outline'"
                          class="h-7 px-2 text-[11px]"
                          @click="applySelectionScope('fanin')"
                        >
                          {{ t('showFanin') }}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          :variant="selectionScope === 'fanout' ? 'default' : 'outline'"
                          class="h-7 px-2 text-[11px]"
                          @click="applySelectionScope('fanout')"
                        >
                          {{ t('showFanout') }}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          :variant="selectionScope === 'cone' ? 'default' : 'outline'"
                          class="h-7 px-2 text-[11px]"
                          @click="applySelectionScope('cone')"
                        >
                          {{ t('showCone') }}
                        </Button>
                      </div>
                    </div>

                    <div v-if="relatedViewSummaries.length" class="py-1">
                      <div
                        class="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {{ t('linkedChunks') }}
                      </div>

                      <div class="ml-4 border-l border-border/50 pl-2">
                        <button
                          v-for="entry in relatedViewSummaries"
                          :key="entry.linked.chunk_id"
                          type="button"
                          class="flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50"
                          @click="openChunk(entry.linked.chunk_id)"
                          @mouseenter="setHovered('chunk', entry.linked.chunk_id)"
                          @mouseleave="clearHovered('chunk')"
                        >
                          <div class="min-w-0 flex-1">
                            <div class="truncate font-medium">
                              {{ getChunkDisplayTitle(entry.summary) }}
                            </div>
                            <div class="mt-0.5 text-xs text-muted-foreground">
                              {{ entry.linked.prominent_signals.join(', ') || '-' }}
                            </div>
                          </div>
                          <div class="shrink-0 text-xs text-muted-foreground">
                            {{ formatCount(entry.linked.edge_count) }}
                          </div>
                        </button>
                      </div>
                    </div>

                    <div v-if="highFanoutNodes.length" class="py-1">
                      <div
                        class="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {{ t('highFanoutNodes') }}
                      </div>

                      <div class="ml-4 border-l border-border/50 pl-2">
                        <button
                          v-for="node in highFanoutNodes"
                          :key="node.id"
                          type="button"
                          :class="
                            cn(
                              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors',
                              selectedNodeId === node.id
                                ? 'bg-primary/10 text-primary'
                                : 'hover:bg-muted/50',
                            )
                          "
                          @click="void focusNode(node.id)"
                          @mouseenter="setHovered('node', node.id)"
                          @mouseleave="clearHovered('node')"
                        >
                          <div class="min-w-0 flex-1">
                            <div class="truncate font-medium">{{ node.label }}</div>
                            <div
                              class="mt-0.5 text-xs"
                              :class="
                                selectedNodeId === node.id
                                  ? 'text-primary/80'
                                  : 'text-muted-foreground'
                              "
                            >
                              {{ node.cell_type || node.direction || node.kind }}
                            </div>
                          </div>
                          <div
                            class="shrink-0 text-right text-xs"
                            :class="
                              selectedNodeId === node.id
                                ? 'text-primary/80'
                                : 'text-muted-foreground'
                            "
                          >
                            <div>fan-out {{ formatCount(node.fanout) }}</div>
                            <div>degree {{ formatCount(node.degree) }}</div>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    </ResizablePanel>

    <ResizableHandle />

    <ResizablePanel :default-size="78" class="bg-background p-0">
      <div class="relative h-full min-h-[420px] overflow-hidden bg-[#060c17]">
        <div ref="viewportRef" class="absolute inset-0">
          <canvas
            ref="canvasRef"
            class="h-full w-full touch-none cursor-grab active:cursor-grabbing"
            @pointerdown="handlePointerDown"
            @pointermove="handlePointerMove"
            @pointerup="handlePointerUp"
            @pointerleave="handlePointerLeave"
            @wheel="handleWheel"
          />
        </div>

        <div class="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2">
          <Badge variant="outline" class="border-sky-500/30 bg-slate-950/80 text-sky-100">
            {{ activeCanvasLabel }}
          </Badge>
          <Badge
            v-if="viewerBusy"
            variant="outline"
            class="border-emerald-500/30 bg-slate-950/80 text-emerald-100"
          >
            <LoaderCircle class="mr-1.5 h-3.5 w-3.5 animate-spin" />
            {{ t('netlistExplorerLoading') }}
          </Badge>
        </div>

        <div class="pointer-events-none absolute right-4 top-4">
          <Badge variant="outline" class="border-border/40 bg-slate-950/80 text-slate-200">
            {{ zoomPercent }}%
          </Badge>
        </div>

        <div
          class="absolute bottom-4 right-4 z-10 w-[min(360px,calc(100%-2rem))] pointer-events-auto"
        >
          <div
            class="overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-950/88 shadow-2xl shadow-black/45 backdrop-blur"
          >
            <div
              class="flex items-start justify-between gap-3 border-b border-slate-800/80 px-4 py-3"
            >
              <div class="min-w-0">
                <div class="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                  {{ t('nodeInspector') }}
                </div>
                <div v-if="selectedNode" class="mt-1 truncate text-sm font-semibold text-slate-100">
                  {{ selectedNode.label }}
                </div>
                <div v-else class="mt-1 text-sm text-slate-300">
                  {{ t('selectNodeToInspect') }}
                </div>
                <div v-if="selectedNode" class="mt-1 truncate text-xs text-slate-400">
                  {{ selectedNode.kind }} ·
                  {{ selectedNode.cell_type || selectedNode.direction || 'node' }}
                </div>
              </div>

              <Button
                v-if="selectedNode"
                type="button"
                size="icon"
                variant="ghost"
                class="h-8 w-8 shrink-0 rounded-full text-slate-300 hover:bg-slate-800 hover:text-white"
                @click="clearSelection"
              >
                <X class="h-4 w-4" />
              </Button>
            </div>

            <div v-if="selectedNode" class="space-y-3 px-4 py-4">
              <div class="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  :variant="selectionScope === 'full' ? 'default' : 'outline'"
                  class="h-7 px-2 text-[11px]"
                  @click="applySelectionScope('full')"
                >
                  {{ t('showAll') }}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  :variant="selectionScope === 'fanin' ? 'default' : 'outline'"
                  class="h-7 px-2 text-[11px]"
                  @click="applySelectionScope('fanin')"
                >
                  {{ t('showFanin') }}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  :variant="selectionScope === 'fanout' ? 'default' : 'outline'"
                  class="h-7 px-2 text-[11px]"
                  @click="applySelectionScope('fanout')"
                >
                  {{ t('showFanout') }}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  :variant="selectionScope === 'cone' ? 'default' : 'outline'"
                  class="h-7 px-2 text-[11px]"
                  @click="applySelectionScope('cone')"
                >
                  {{ t('showCone') }}
                </Button>
              </div>

              <ScrollArea class="max-h-[min(46vh,420px)] pr-3">
                <div class="overflow-hidden rounded-xl border border-slate-800/90 bg-slate-900/75">
                  <div
                    class="grid grid-cols-[104px_minmax(0,1fr)] border-b border-slate-800 bg-slate-900/95 text-[10px] uppercase tracking-[0.16em] text-slate-500"
                  >
                    <div class="px-3 py-2">{{ t('name') }}</div>
                    <div class="px-3 py-2">{{ t('valueLabel') }}</div>
                  </div>

                  <div
                    v-for="(row, index) in selectedNodePropertyRows"
                    :key="`${selectedNode.id}:${index}:${row.label}`"
                    class="grid grid-cols-[104px_minmax(0,1fr)] border-b border-slate-800/80 text-[11px] last:border-b-0"
                  >
                    <div class="px-3 py-2 text-slate-400">
                      {{ row.label }}
                    </div>
                    <div
                      class="px-3 py-2 break-all text-slate-100"
                      :class="row.monospace && 'font-mono text-[10.5px]'"
                    >
                      {{ row.value }}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </div>

            <div v-else class="px-4 py-4 text-xs leading-5 text-slate-400">
              {{ t('selectNodeToInspect') }}
            </div>
          </div>
        </div>

        <div
          v-if="!overview && !viewerBusy"
          class="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center"
        >
          <div
            class="max-w-md space-y-2 rounded-2xl border border-border/20 bg-slate-950/60 px-5 py-4 text-sm text-slate-300 backdrop-blur"
          >
            <p>{{ errorMessage || t('netlistExplorerUnavailable') }}</p>
          </div>
        </div>
      </div>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>
