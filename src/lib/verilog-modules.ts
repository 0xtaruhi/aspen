export function extractVerilogModuleNames(code: string): string[] {
  const cleanCode = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  return Array.from(
    cleanCode.matchAll(/\bmodule\s+([A-Za-z_][A-Za-z0-9_]*)/g),
    (match: RegExpMatchArray) => match[1],
  )
}
