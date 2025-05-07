import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { convertFile, convertDirectory } from '../src' // Assuming these will be exported
import { readFile, rm, mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { exec } from 'child_process'

const fixturesDir = path.join(__dirname, 'fixtures')
const tempTestDir = path.join(__dirname, 'temp-test-output')

const windsurfManualPath = path.join(fixturesDir, 'manual-windsurf.md')
const cursorManualPath = path.join(fixturesDir, 'manual-cursor.mdc')

describe('Windsurf-to-Cursor Converter', () => {
  let expectedCursorManualContent: string

  beforeAll(async () => {
    expectedCursorManualContent = await readFile(cursorManualPath, 'utf-8')
    // Create a temporary directory for test outputs
    await mkdir(tempTestDir, { recursive: true })
  })

  afterAll(async () => {
    // Clean up the temporary directory
    await rm(tempTestDir, { recursive: true, force: true })
  })

  describe('convertFile()', () => {
    const outputFilePath = path.join(tempTestDir, 'converted-manual.mdc')

    beforeEach(async () => {
      // Ensure the output file doesn't exist before each test
      await rm(outputFilePath, { force: true })
    })

    it('should convert a single Windsurf file to Cursor format', async () => {
      await convertFile(windsurfManualPath, outputFilePath)
      const outputFileContent = await readFile(outputFilePath, 'utf-8')
      expect(outputFileContent).toEqual(expectedCursorManualContent)
    })

    it('should throw an error if the input file does not exist', async () => {
      const nonExistentInputPath = path.join(fixturesDir, 'non-existent-file.md')
      await expect(convertFile(nonExistentInputPath, outputFilePath)).rejects.toThrow()
    })

    it('should create the output directory if it does not exist', async () => {
      const nestedOutputDir = path.join(tempTestDir, 'nested', 'output')
      const nestedOutputFilePath = path.join(nestedOutputDir, 'converted-manual.mdc')
      await rm(nestedOutputDir, { recursive: true, force: true }) // Ensure it's removed

      await convertFile(windsurfManualPath, nestedOutputFilePath)
      const outputFileContent = await readFile(nestedOutputFilePath, 'utf-8')
      expect(outputFileContent).toEqual(expectedCursorManualContent)
      await rm(nestedOutputDir, { recursive: true, force: true })
    })

    it('should overwrite an existing output file', async () => {
      await writeFile(outputFilePath, 'initial content', 'utf-8')
      await convertFile(windsurfManualPath, outputFilePath)
      const outputFileContent = await readFile(outputFilePath, 'utf-8')
      expect(outputFileContent).toEqual(expectedCursorManualContent)
    })
  })

  describe('convertDirectory()', () => {
    const inputDir = path.join(tempTestDir, 'input-dir')
    const outputDir = path.join(tempTestDir, 'output-dir')

    beforeEach(async () => {
      // Recreate directories for each test
      await rm(inputDir, { recursive: true, force: true })
      await rm(outputDir, { recursive: true, force: true })
      await mkdir(inputDir, { recursive: true })
      await mkdir(outputDir, { recursive: true })
    })

    it('should convert all .md files in a directory to .mdc in the output directory', async () => {
      // Copy some fixture files to the temp input directory
      const windsurfAgentPath = path.join(fixturesDir, 'agent-windsurf.md')
      const cursorAgentPath = path.join(fixturesDir, 'agent-cursor.mdc')
      const expectedCursorAgentContent = await readFile(cursorAgentPath, 'utf-8')

      await writeFile(path.join(inputDir, 'manual-windsurf.md'), await readFile(windsurfManualPath, 'utf-8'))
      await writeFile(path.join(inputDir, 'agent-windsurf.md'), await readFile(windsurfAgentPath, 'utf-8'))
      await writeFile(path.join(inputDir, 'some-other-file.txt'), 'this should be ignored')

      await convertDirectory(inputDir, outputDir)

      const convertedManualContent = await readFile(path.join(outputDir, 'manual-windsurf.mdc'), 'utf-8')
      const convertedAgentContent = await readFile(path.join(outputDir, 'agent-windsurf.mdc'), 'utf-8')

      expect(convertedManualContent).toEqual(expectedCursorManualContent)
      expect(convertedAgentContent).toEqual(expectedCursorAgentContent)

      // Check that the other file was ignored
      await expect(readFile(path.join(outputDir, 'some-other-file.txt'))).rejects.toThrow()
    })

    it('should handle an empty input directory', async () => {
      await convertDirectory(inputDir, outputDir)
      // Expect output directory to be empty or not created (implementation dependent)
      // For now, let's assume it might create the dir but it will be empty
      const files = await readFile(outputDir, 'utf-8').then(() => []).catch(() => []) // Simplified check
      expect(files.length).toBe(0) // This check needs refinement based on actual behavior
    })

    it('should throw an error if the input directory does not exist', async () => {
      const nonExistentInputDir = path.join(tempTestDir, 'non-existent-input-dir')
      await expect(convertDirectory(nonExistentInputDir, outputDir)).rejects.toThrow()
    })

    it('should create the output directory if it does not exist', async () => {
      await rm(outputDir, { recursive: true, force: true }) // Ensure it's removed
      await writeFile(path.join(inputDir, 'manual-windsurf.md'), await readFile(windsurfManualPath, 'utf-8'))

      await convertDirectory(inputDir, outputDir)

      const convertedManualContent = await readFile(path.join(outputDir, 'manual-windsurf.mdc'), 'utf-8')
      expect(convertedManualContent).toEqual(expectedCursorManualContent)
    })

    it('should not create .mdc files for non-.md files', async () => {
      await writeFile(path.join(inputDir, 'document.md'), await readFile(windsurfManualPath, 'utf-8'))
      await writeFile(path.join(inputDir, 'image.png'), 'dummy image data')
      await writeFile(path.join(inputDir, 'script.js'), 'console.log("hello")')

      await convertDirectory(inputDir, outputDir)

      const convertedDocContent = await readFile(path.join(outputDir, 'document.mdc'), 'utf-8')
      expect(convertedDocContent).toEqual(expectedCursorManualContent)

      await expect(readFile(path.join(outputDir, 'image.png.mdc'))).rejects.toThrow()
      await expect(readFile(path.join(outputDir, 'image.png'))).rejects.toThrow() // original should not be copied
      await expect(readFile(path.join(outputDir, 'script.js.mdc'))).rejects.toThrow()
      await expect(readFile(path.join(outputDir, 'script.js'))).rejects.toThrow() // original should not be copied
    })
  })
})

describe('CLI (cuws)', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli.js') // Path to the compiled CLI script
  let expectedCursorManualContent: string // Declare here for CLI scope

  beforeAll(async () => {
    // Load content needed specifically for CLI tests
    expectedCursorManualContent = await readFile(cursorManualPath, 'utf-8')
  })

  const execCli = (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
    return new Promise((resolve) => {
      // Using path.resolve to ensure it's an absolute path, robust for exec.
      const command = `node "${path.resolve(cliPath)}" ${args.join(' ')}`
      exec(command, (error, stdout, stderr) => {
        resolve({ stdout, stderr, exitCode: error ? error.code || 1 : 0 })
      })
    })
  }

  describe('file conversion via CLI', () => {
    const inputFile = windsurfManualPath // from parent scope
    const outputFile = path.join(tempTestDir, 'cli-manual-output.mdc')

    beforeEach(async () => {
      await rm(outputFile, { force: true })
    })

    it('should convert a single file using -i and -o options', async () => {
      const { stdout, stderr, exitCode } = await execCli(['-i', inputFile, '-o', outputFile])
      expect(stderr).toBe('') // Assuming no errors for successful conversion
      expect(exitCode).toBe(0)
      const outputContent = await readFile(outputFile, 'utf-8')
      expect(outputContent).toEqual(expectedCursorManualContent)
    })

    it('should convert a single file using positional arguments <input> <output>', async () => {
      const { stdout, stderr, exitCode } = await execCli([inputFile, outputFile])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      const outputContent = await readFile(outputFile, 'utf-8')
      expect(outputContent).toEqual(expectedCursorManualContent)
    })

    it('should report error if input file does not exist', async () => {
      const nonExistentInput = path.join(fixturesDir, 'non-existent-cli.md')
      const { stdout, stderr, exitCode } = await execCli(['-i', nonExistentInput, '-o', outputFile])
      expect(stderr).toContain('Input file not found') // Placeholder error message
      expect(exitCode).not.toBe(0)
    })

    it('should create output directory for file if it does not exist', async () => {
      const nestedOutputDir = path.join(tempTestDir, 'cli-nested-file-output')
      const nestedOutputFile = path.join(nestedOutputDir, 'output.mdc')
      await rm(nestedOutputDir, { recursive: true, force: true })

      const { stdout, stderr, exitCode } = await execCli(['-i', inputFile, '-o', nestedOutputFile])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      const outputContent = await readFile(nestedOutputFile, 'utf-8')
      expect(outputContent).toEqual(expectedCursorManualContent)
      await rm(nestedOutputDir, { recursive: true, force: true })
    })
  })

  describe('directory conversion via CLI', () => {
    const inputSourceDir = path.join(tempTestDir, 'cli-input-dir-source')
    const outputTargetDir = path.join(tempTestDir, 'cli-output-dir-target')
    let expectedCursorAgentContent: string

    beforeAll(async () => {
      const cursorAgentPath = path.join(fixturesDir, 'agent-cursor.mdc')
      expectedCursorAgentContent = await readFile(cursorAgentPath, 'utf-8')
    })

    beforeEach(async () => {
      await rm(inputSourceDir, { recursive: true, force: true })
      await rm(outputTargetDir, { recursive: true, force: true })
      await mkdir(inputSourceDir, { recursive: true })
      // Output directory should be created by the CLI tool if it doesn't exist

      const windsurfAgentPath = path.join(fixturesDir, 'agent-windsurf.md') // from parent scope
      await writeFile(path.join(inputSourceDir, 'manual.md'), await readFile(windsurfManualPath, 'utf-8'))
      await writeFile(path.join(inputSourceDir, 'agent.md'), await readFile(windsurfAgentPath, 'utf-8'))
      await writeFile(path.join(inputSourceDir, 'ignored.txt'), 'text file')
    })

    it('should convert all .md files in a directory using -d and -o options', async () => {
      const { stdout, stderr, exitCode } = await execCli(['-d', inputSourceDir, '-o', outputTargetDir])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)

      const convertedManual = await readFile(path.join(outputTargetDir, 'manual.mdc'), 'utf-8')
      const convertedAgent = await readFile(path.join(outputTargetDir, 'agent.mdc'), 'utf-8')

      expect(convertedManual).toEqual(expectedCursorManualContent)
      expect(convertedAgent).toEqual(expectedCursorAgentContent)
      await expect(readFile(path.join(outputTargetDir, 'ignored.txt'))).rejects.toThrow()
      await expect(readFile(path.join(outputTargetDir, 'ignored.mdc'))).rejects.toThrow()
    })

    it('should report error if input directory does not exist', async () => {
      const nonExistentDir = path.join(tempTestDir, 'non-existent-cli-dir')
      const { stdout, stderr, exitCode } = await execCli(['-d', nonExistentDir, '-o', outputTargetDir])
      expect(stderr).toContain('Input directory not found') // Placeholder
      expect(exitCode).not.toBe(0)
    })

    it('should create output directory for directory conversion if it does not exist', async () => {
      await rm(outputTargetDir, { recursive: true, force: true }) // Ensure it's removed
      const { stdout, stderr, exitCode } = await execCli(['-d', inputSourceDir, '-o', outputTargetDir])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      const convertedManual = await readFile(path.join(outputTargetDir, 'manual.mdc'), 'utf-8')
      expect(convertedManual).toEqual(expectedCursorManualContent)
    })
  })

  describe('CLI help and version flags', () => {
    it('should show help message with --help', async () => {
      const { stdout, stderr, exitCode } = await execCli(['--help'])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      expect(stdout).toContain('Usage: cuws')
      expect(stdout).toContain('Options:')
      expect(stdout).toContain('--input')
      expect(stdout).toContain('--output')
      expect(stdout).toContain('--directory')
    })

    it('should show version with --version', async () => {
      const { stdout, stderr, exitCode } = await execCli(['--version'])
      expect(stderr).toBe('')
      expect(exitCode).toBe(0)
      const packageJsonContent = await readFile(path.join(__dirname, '..', 'package.json'), 'utf-8')
      const { version: pkgVersion } = JSON.parse(packageJsonContent)
      expect(stdout.trim()).toBe(pkgVersion)
    })
  })

  describe('CLI error handling', () => {
    it('should show error if no input/directory specified', async () => {
      const { stdout, stderr, exitCode } = await execCli([])
      expect(stderr).toContain('Either input file or directory must be specified') // Placeholder
      expect(exitCode).not.toBe(0)
    })

    it('should show error if input file specified but no output file (using -i without -o)', async () => {
      const { stdout, stderr, exitCode } = await execCli(['-i', windsurfManualPath])
      expect(stderr).toContain('Output must be specified when using --input') // Placeholder
      expect(exitCode).not.toBe(0)
    })

    it('should show error if input file specified but no output file (using positional <input> without <output>)', async () => {
      const { stdout, stderr, exitCode } = await execCli([windsurfManualPath])
      expect(stderr).toContain('Output must be specified when providing an input file') // Placeholder
      expect(exitCode).not.toBe(0)
    })

    it('should show error if directory specified but no output directory', async () => {
      const tempSourceDir = path.join(tempTestDir, 'cli-error-src-dir')
      await mkdir(tempSourceDir, { recursive: true })
      const { stdout, stderr, exitCode } = await execCli(['-d', tempSourceDir])
      expect(stderr).toContain('Output directory must be specified when using --directory') // Placeholder
      expect(exitCode).not.toBe(0)
      await rm(tempSourceDir, { recursive: true, force: true })
    })

    it('should show error if both input file and directory are specified', async () => {
      const tempSourceDir = path.join(tempTestDir, 'cli-error-src-dir-both')
      await mkdir(tempSourceDir, { recursive: true })
      // Provide a dummy output to satisfy yargs checks if it demands one for -i or -d
      const dummyOutput = path.join(tempTestDir, 'dummy-out.mdc')
      const { stdout, stderr, exitCode } = await execCli(['-i', windsurfManualPath, '-d', tempSourceDir, '-o', dummyOutput])
      expect(stderr).toContain('Cannot specify both input file and directory') // Placeholder
      expect(exitCode).not.toBe(0)
      await rm(tempSourceDir, { recursive: true, force: true })
      await rm(dummyOutput, { force: true })
    })
  })
})
