import type { VerilogPort } from './verilog-parser'

export type ExpandedVerilogPortBit = VerilogPort & {
  bitName: string
  baseName: string
  bitIndex: number | null
}

const widthPattern = /^\[\s*(-?\d+)\s*:\s*(-?\d+)\s*\]$/

function parseWidthBounds(width: string) {
  const match = width.trim().match(widthPattern)
  if (!match) {
    return null
  }

  return {
    left: Number.parseInt(match[1], 10),
    right: Number.parseInt(match[2], 10),
  }
}

export function expandVerilogPortBits(port: VerilogPort): ExpandedVerilogPortBit[] {
  const bounds = parseWidthBounds(port.width)
  if (!bounds || bounds.left === bounds.right) {
    return [
      {
        ...port,
        bitName: port.name,
        baseName: port.name,
        bitIndex: bounds ? bounds.left : null,
      },
    ]
  }

  const small = Math.min(bounds.left, bounds.right)
  const large = Math.max(bounds.left, bounds.right)

  return Array.from({ length: large - small + 1 }, (_, offset) => {
    const bitIndex = small + offset
    return {
      ...port,
      bitName: `${port.name}[${bitIndex}]`,
      baseName: port.name,
      bitIndex,
    }
  })
}

export function expandVerilogPorts(ports: readonly VerilogPort[]): ExpandedVerilogPortBit[] {
  return ports.flatMap((port) => expandVerilogPortBits(port))
}
