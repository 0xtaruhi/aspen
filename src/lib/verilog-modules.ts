export function extractVerilogModuleNames(code: string): string[] {
  const cleanCode = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const moduleNames: string[] = []
  const seen = new Set<string>()

  for (const match of cleanCode.matchAll(
    /\bmodule\s+(?:(?:automatic|static)\s+)*(\\\S+|[A-Za-z_][A-Za-z0-9_$]*)/g,
  )) {
    const moduleName = match[1]
    if (!moduleName || seen.has(moduleName)) {
      continue
    }

    seen.add(moduleName)
    moduleNames.push(moduleName)
  }

  return moduleNames
}
