export type ParsedTimingPathStep = {
  label: string
  line: string
}

export type ParsedTimingPath = {
  id: string
  title: string
  slackValue: number | null
  slackText: string | null
  startpoint: string | null
  endpoint: string | null
  steps: ParsedTimingPathStep[]
}

const MAX_PATHS = 3
const MAX_STEPS = 24

const IGNORED_STEP_LABELS = new Set([
  'data',
  'delay',
  'arrival',
  'required',
  'slack',
  'clock',
  'path',
  'point',
  'fanout',
  'net',
  'cell',
  'rise',
  'fall',
  'input',
  'output',
  'setup',
  'hold',
  'time',
  'library',
  'edge',
])

export function parseTimingReportPaths(report: string): ParsedTimingPath[] {
  const trimmedReport = report.trim()
  if (!trimmedReport) {
    return []
  }

  const blocks = splitTimingBlocks(trimmedReport)

  const paths = blocks
    .map((block, index) => parseTimingBlock(block, index))
    .filter((path): path is ParsedTimingPath => path !== null)

  return paths
    .sort((left, right) => {
      if (left.slackValue !== null && right.slackValue !== null) {
        return left.slackValue - right.slackValue
      }
      if (left.slackValue !== null) {
        return -1
      }
      if (right.slackValue !== null) {
        return 1
      }
      return left.id.localeCompare(right.id)
    })
    .slice(0, MAX_PATHS)
}

export function buildTimingSearchAliases(label: string, topModuleName = '') {
  const trimmed = label.trim()
  const aliases = [trimmed]

  if (!trimmed) {
    return []
  }

  if (trimmed.startsWith('\\')) {
    aliases.push(trimmed.slice(1))
  }

  if (topModuleName) {
    for (const separator of ['/', '.']) {
      const prefix = `${topModuleName}${separator}`
      if (trimmed.startsWith(prefix)) {
        aliases.push(trimmed.slice(prefix.length))
      }
    }
  }

  if (trimmed.includes('/')) {
    const segments = trimmed.split('/').filter(Boolean)
    const tail = segments[segments.length - 1] ?? ''
    const parent = segments.slice(0, -1).join('/')
    const base = segments[segments.length - 2] ?? tail

    aliases.push(tail, base)

    if (segments.length > 1 && looksLikePinSegment(tail)) {
      aliases.push(parent)
      aliases.push(base)
    }
  }

  if (trimmed.includes('.')) {
    const segments = trimmed.split('.').filter(Boolean)
    aliases.push(segments[segments.length - 1] ?? '')
  }

  const withoutIndex = trimmed.replace(/\[[^\]]+\]$/, '')
  aliases.push(withoutIndex)

  return uniqueAliases(aliases)
}

function splitTimingBlocks(report: string) {
  const lines = report.split(/\r?\n/)
  const blocks: string[] = []
  let currentBlock: string[] = []

  for (const line of lines) {
    const trimmedLine = line.trim()
    const startsNewBlock =
      currentBlock.length > 0 && /^(?:startpoint:|critical path\b|path\s+\d+\b)/i.test(trimmedLine)

    if (startsNewBlock) {
      blocks.push(currentBlock.join('\n').trim())
      currentBlock = [line]
      continue
    }

    currentBlock.push(line)
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n').trim())
  }

  return blocks.filter((block) => block.length > 0)
}

function parseTimingBlock(block: string, index: number): ParsedTimingPath | null {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return null
  }

  const blockText = lines.join('\n')
  const slackMatch = blockText.match(/\b(?:slack|wns)\b[^-\d]*(-?\d+(?:\.\d+)?)/i)
  const startpoint = extractNamedField(blockText, 'startpoint')
  const endpoint = extractNamedField(blockText, 'endpoint')

  const arrowSteps = extractArrowSteps(lines)
  const tableSteps = arrowSteps.length > 0 ? [] : extractTableSteps(lines)
  const mergedSteps = uniqueLabels([
    ...(startpoint ? [startpoint] : []),
    ...arrowSteps,
    ...tableSteps,
    ...(endpoint ? [endpoint] : []),
  ]).slice(0, MAX_STEPS)

  if (!slackMatch && !startpoint && !endpoint && mergedSteps.length < 2) {
    return null
  }

  const firstStep = mergedSteps[0] ?? startpoint ?? `Path ${index + 1}`
  const lastStep = mergedSteps[mergedSteps.length - 1] ?? endpoint ?? firstStep

  return {
    id: `timing-path-${index}`,
    title: firstStep === lastStep ? firstStep : `${firstStep} -> ${lastStep}`,
    slackValue: slackMatch ? Number(slackMatch[1]) : null,
    slackText: slackMatch ? slackMatch[1] : null,
    startpoint,
    endpoint,
    steps: mergedSteps.map((label) => ({
      label,
      line: lines.find((line) => line.includes(label)) ?? label,
    })),
  }
}

function extractNamedField(blockText: string, fieldName: 'startpoint' | 'endpoint') {
  const regex = new RegExp(`${fieldName}\\s*:\\s*([^\\n]+)`, 'i')
  const match = blockText.match(regex)
  if (!match) {
    return null
  }

  return sanitizeStepLabel(match[1])
}

function extractArrowSteps(lines: string[]) {
  const labels: string[] = []

  for (const line of lines) {
    if (!/(?:->|=>|==>|→)/.test(line)) {
      continue
    }

    const parts = line.split(/\s*(?:->|=>|==>|→)\s*/g)
    for (const part of parts) {
      const label = sanitizeStepLabel(part)
      if (label) {
        labels.push(label)
      }
    }
  }

  return labels
}

function extractTableSteps(lines: string[]) {
  const labels: string[] = []

  for (const line of lines) {
    const match = line.match(/^(?:\d+[\)\.]?\s+)?([A-Za-z_$\\][\w.$/\\\[\]-]*)\s{2,}/)
    if (!match) {
      continue
    }

    const label = sanitizeStepLabel(match[1])
    if (label) {
      labels.push(label)
    }
  }

  return labels
}

function sanitizeStepLabel(value: string) {
  const trimmed = value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:|.-]+|[\s:|.-]+$/g, '')
    .trim()

  if (!trimmed) {
    return null
  }

  const firstToken = trimmed.split(/\s+/)[0]
  const normalized = firstToken.toLowerCase()
  if (IGNORED_STEP_LABELS.has(normalized)) {
    return null
  }

  if (!/[A-Za-z_$\\]/.test(firstToken)) {
    return null
  }

  return firstToken
}

function uniqueLabels(labels: Array<string | null>) {
  const result: string[] = []
  const seen = new Set<string>()

  for (const label of labels) {
    if (!label || seen.has(label)) {
      continue
    }
    seen.add(label)
    result.push(label)
  }

  return result
}

function looksLikePinSegment(value: string) {
  return /^[A-Z][A-Z0-9_]{0,5}$/.test(value) || /^[A-Za-z]\d{0,2}$/.test(value)
}

function uniqueAliases(values: string[]) {
  const result: string[] = []
  const seen = new Set<string>()

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    result.push(normalized)
  }

  return result
}
