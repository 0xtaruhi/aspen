import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ConverterFactory } from 'opencc-js/core'
import fromCn from 'opencc-js/from/cn'
import toTwp from 'opencc-js/to/twp'
import ts from 'typescript'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')
const inputDir = path.join(rootDir, 'src/components/virtual-device/manuals/content/zh-CN')
const outputDir = path.join(rootDir, 'src/components/virtual-device/manuals/content/zh-TW')
const registryPath = path.join(rootDir, 'src/components/virtual-device/manuals/registry.ts')
const generatedTextPath = path.join(
  rootDir,
  'src/components/virtual-device/manuals/zh-TW.generated.json',
)

const convertToTraditionalChinese = ConverterFactory(fromCn, toTwp)

fs.mkdirSync(outputDir, { recursive: true })

for (const entry of fs.readdirSync(inputDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) {
    continue
  }

  const inputPath = path.join(inputDir, entry.name)
  const outputPath = path.join(outputDir, entry.name)
  const source = fs.readFileSync(inputPath, 'utf8')
  const converted = convertToTraditionalChinese(source)
  fs.writeFileSync(outputPath, converted)
}

const registrySource = fs.readFileSync(registryPath, 'utf8')
const sourceFile = ts.createSourceFile(registryPath, registrySource, ts.ScriptTarget.Latest, true)
const localizedTextMap = {}

function visit(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'txt' &&
    node.arguments.length >= 2
  ) {
    const zhCnArg = node.arguments[1]
    if (ts.isStringLiteralLike(zhCnArg)) {
      localizedTextMap[zhCnArg.text] = convertToTraditionalChinese(zhCnArg.text)
    }
  }

  ts.forEachChild(node, visit)
}

visit(sourceFile)

fs.writeFileSync(generatedTextPath, JSON.stringify(localizedTextMap, null, 2) + '\n')

console.log(
  `Generated ${path.relative(rootDir, outputDir)} and ${path.relative(rootDir, generatedTextPath)}.`,
)
