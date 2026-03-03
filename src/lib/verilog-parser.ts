export interface VerilogPort {
  name: string
  direction: 'input' | 'output' | 'inout'
  width: string // e.g., "[7:0]" or ""
}

export function parseVerilogPorts(code: string): VerilogPort[] {
  const ports: VerilogPort[] = []

  // Remove comments
  const cleanCode = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  // Regex for module definition (simplified)
  // Matches: module name ( ... ports ... );
  // This is a naive parser, assuming standard formatting

  // Strategy: Find "input/output" declarations
  // Regex to match: (input|output|inout) [range] name, name, ...;

  const portRegex = /(input|output|inout)\s+(?:(\[[^\]]+\])\s+)?([^;]+);/g

  let match
  while ((match = portRegex.exec(cleanCode)) !== null) {
    const direction = match[1] as 'input' | 'output' | 'inout'
    const width = match[2] || ''
    const names = match[3].split(',').map((s) => s.trim())

    for (const name of names) {
      ports.push({
        name,
        direction,
        width,
      })
    }
  }

  // Also handle ANSI style ports in module declaration: module foo (input [7:0] a, output b);
  // This is harder with regex, but let's try a basic one for the module header

  return ports
}
