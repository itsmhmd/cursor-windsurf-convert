import { describe, expect, it } from 'vitest'
import { getPackageExportsManifest } from 'vitest-package-exports'
import yaml from 'yaml'
import path from 'path'
import { readFile } from 'fs/promises'

const IS_READY = true // Enable the tests

describe.runIf(IS_READY)('exports-snapshot', async () => {
  const packageJsonPath = path.join(__dirname, '..', 'package.json')
  const packageJsonContent = await readFile(packageJsonPath, 'utf-8')
  const { name: packageName } = JSON.parse(packageJsonContent)

  it(`${packageName} exports`, async () => {
    const manifest = await getPackageExportsManifest({
      // importMode: 'src', // 'src' mode might try to resolve from src/, but our exports point to dist/
      // Let's try with default importMode or 'dist' if 'src' causes issues after build
      cwd: path.join(__dirname, '..'), // Project root
    })
    // We expect exports for '.', and './package.json' as defined in package.json
    // The manifest.exports structure might be nested.
    // For now, let's snapshot the entire exports object.
    await expect(yaml.stringify(manifest.exports))
      .toMatchFileSnapshot(`./exports/${packageName}.yaml`)
  })
})
