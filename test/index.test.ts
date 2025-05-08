import { exec } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { convertDirectory, convertFile } from '../src';

const fixturesDir = path.join(__dirname, 'fixtures');
const tempTestDir = path.join(__dirname, 'temp-test-output');

const windsurfManualPath = path.join(fixturesDir, 'manual-windsurf.md');
const cursorManualPath = path.join(fixturesDir, 'manual-cursor.mdc');

describe('Windsurf-to-Cursor Converter', () => {
  let expectedCursorManualContent: string;

  beforeAll(async () => {
    expectedCursorManualContent = (
      await readFile(cursorManualPath, 'utf-8')
    ).replace(/\r\n/g, '\n');
    // Create a temporary directory for test outputs
    await mkdir(tempTestDir, { recursive: true });
  });

  afterAll(async () => {
    // Clean up the temporary directory
    await rm(tempTestDir, { recursive: true, force: true });
  });

  describe('convertFile()', () => {
    const outputFilePath = path.join(tempTestDir, 'converted-manual.mdc');
    // Use beforeAll/afterAll for main temp dir cleanup

    // No general beforeEach needed here, add specific cleanup inside tests if required

    it('should convert a single Windsurf file to Cursor format', async () => {
      await rm(outputFilePath, { force: true }); // Ensure clean state for this test
      await convertFile(windsurfManualPath, outputFilePath);
      const outputFileContent = await readFile(outputFilePath, 'utf-8');
      expect(outputFileContent).toEqual(expectedCursorManualContent);
    });

    it('should throw an error if the input file does not exist', async () => {
      const nonExistentInputPath = path.join(
        fixturesDir,
        'non-existent-file.md'
      );
      await expect(
        convertFile(nonExistentInputPath, outputFilePath)
      ).rejects.toThrow();
    });

    it('should create the output directory if it does not exist', async () => {
      const nestedOutputDir = path.join(tempTestDir, 'nested', 'output');
      const nestedOutputFilePath = path.join(
        nestedOutputDir,
        'converted-manual.mdc'
      );
      await rm(nestedOutputDir, { recursive: true, force: true }); // Clean before this test

      await convertFile(windsurfManualPath, nestedOutputFilePath);
      const outputFileContent = await readFile(nestedOutputFilePath, 'utf-8');
      expect(outputFileContent).toEqual(expectedCursorManualContent);
      await rm(nestedOutputDir, { recursive: true, force: true });
    });

    it('should overwrite an existing output file', async () => {
      await rm(outputFilePath, { force: true }); // Ensure clean state
      await writeFile(outputFilePath, 'initial content', 'utf-8'); // Create file to overwrite
      await convertFile(windsurfManualPath, outputFilePath);
      const outputFileContent = await readFile(outputFilePath, 'utf-8');
      expect(outputFileContent).toEqual(expectedCursorManualContent);
    });
  });

  describe('convertDirectory()', () => {
    const inputDir = path.join(tempTestDir, 'input-dir');
    const outputDir = path.join(tempTestDir, 'output-dir');

    beforeEach(async () => {
      // Recreate directories for each test
      await rm(inputDir, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
      await mkdir(inputDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });
    });

    it('should convert all .md files in a directory to .mdc in the output directory', async () => {
      // beforeEach handles setup

      // Copy some fixture files to the temp input directory
      const windsurfAgentPath = path.join(fixturesDir, 'agent-windsurf.md');
      const cursorAgentPath = path.join(fixturesDir, 'agent-cursor.mdc');
      const expectedCursorAgentContent = (
        await readFile(cursorAgentPath, 'utf-8')
      ).replace(/\r\n/g, '\n');

      await writeFile(
        path.join(inputDir, 'manual-windsurf.md'),
        await readFile(windsurfManualPath, 'utf-8')
      );
      await writeFile(
        path.join(inputDir, 'agent-windsurf.md'),
        await readFile(windsurfAgentPath, 'utf-8')
      );
      await writeFile(
        path.join(inputDir, 'some-other-file.txt'),
        'this should be ignored'
      );

      await convertDirectory(inputDir, outputDir);

      const convertedManualContent = await readFile(
        path.join(outputDir, 'manual-windsurf.mdc'),
        'utf-8'
      );
      const convertedAgentContent = await readFile(
        path.join(outputDir, 'agent-windsurf.mdc'),
        'utf-8'
      );

      expect(convertedManualContent).toEqual(expectedCursorManualContent);
      expect(convertedAgentContent).toEqual(expectedCursorAgentContent);

      // Check that the other file was ignored
      await expect(
        readFile(path.join(outputDir, 'some-other-file.txt'))
      ).rejects.toThrow();
    });

    it('should handle an empty input directory', async () => {
      // beforeEach handles setup
      await convertDirectory(inputDir, outputDir);
      // Expect output directory to be empty
      const files = await readdir(outputDir);
      expect(files.length).toBe(0);
    });

    it('should throw an error if the input directory does not exist', async () => {
      // beforeEach handles setup, just need non-existent path
      const nonExistentInputDir = path.join(
        tempTestDir,
        'non-existent-input-dir'
      );
      await expect(
        convertDirectory(nonExistentInputDir, outputDir)
      ).rejects.toThrow();
    });

    it('should create the output directory if it does not exist', async () => {
      // beforeEach handles inputDir setup, just need to remove outputDir
      await rm(outputDir, { recursive: true, force: true });
      // Write file *inside* the test after beforeEach creates inputDir
      await writeFile(
        path.join(inputDir, 'manual-windsurf.md'),
        await readFile(windsurfManualPath, 'utf-8')
      );

      await convertDirectory(inputDir, outputDir);

      const convertedManualContent = await readFile(
        path.join(outputDir, 'manual-windsurf.mdc'),
        'utf-8'
      );
      expect(convertedManualContent).toEqual(expectedCursorManualContent);
    });

    it('should not create .mdc files for non-.md files', async () => {
      // beforeEach handles setup
      await writeFile(
        path.join(inputDir, 'document.md'),
        await readFile(windsurfManualPath, 'utf-8')
      );
      await writeFile(path.join(inputDir, 'image.png'), 'dummy image data');
      await writeFile(path.join(inputDir, 'script.js'), 'console.log("hello")');

      // Explicitly set direction to 'cw' (Cursor to Windsurf)
      // This means the function expects .mdc files as input.
      // Since 'document.md' is not a .mdc file, it should be skipped.
      await convertDirectory(inputDir, outputDir, { direction: 'cw' });

      // Expect document.mdc NOT to be created because input was .md and direction is cw
      await expect(
        readFile(path.join(outputDir, 'document.mdc'))
        // biome-ignore lint/performance/useTopLevelRegex: test case
      ).rejects.toThrow(/ENOENT/);

      // Expect other non-md files not to be converted or copied
      await expect(
        readFile(path.join(outputDir, 'image.png.mdc'))
      ).rejects.toThrow();
      await expect(
        readFile(path.join(outputDir, 'image.png'))
      ).rejects.toThrow(); // original should not be copied
      await expect(
        readFile(path.join(outputDir, 'script.js.mdc'))
      ).rejects.toThrow();
      await expect(
        readFile(path.join(outputDir, 'script.js'))
      ).rejects.toThrow(); // original should not be copied
    });
  });
});

describe('CLI (cuws)', () => {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli.mjs'); // Use .mjs extension
  let expectedCursorManualContent: string; // Declare here for CLI scope

  beforeAll(async () => {
    // Load content needed specifically for CLI tests
    // This variable is re-declared in this scope, so it needs normalization here too.
    expectedCursorManualContent = (
      await readFile(cursorManualPath, 'utf-8')
    ).replace(/\r\n/g, '\n');
  });

  const execCli = (
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
    return new Promise((resolve) => {
      const command = `node "${path.resolve(cliPath)}" ${args.join(' ')}`;
      const child = exec(command);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data;
      });
      child.stderr?.on('data', (data) => {
        stderr += data;
      });

      let resolved = false;
      const resolveOnce = (result: {
        stdout: string;
        stderr: string;
        exitCode: number | null;
      }) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      child.on('close', (code) => {
        // 'close' fires when stdio streams are closed
        resolveOnce({ stdout, stderr, exitCode: code });
      });

      child.on('exit', (code) => {
        // 'exit' fires when the process actually exits
        resolveOnce({ stdout, stderr, exitCode: code });
      });

      child.on('error', (err) => {
        // Handle errors launching the process itself
        console.error('execCli launch error:', err);
        // Resolve with a non-zero code and the error message in stderr
        resolve({ stdout, stderr: stderr + err.message, exitCode: 1 });
      });
    });
  };

  describe('file conversion via CLI', () => {
    const inputFile = windsurfManualPath; // from parent scope
    const outputFile = path.join(tempTestDir, 'cli-manual-output.mdc');

    beforeEach(async () => {
      await rm(outputFile, { force: true });
    });

    it('should convert a single file using -i and -o options', async () => {
      const { stderr, exitCode } = await execCli([
        '-i',
        inputFile,
        '-o',
        outputFile,
        '-r', // Add reverse flag for Windsurf to Cursor
      ]);
      expect(stderr).toBe(''); // Assuming no errors for successful conversion
      expect(exitCode).toBe(0);
      const outputContent = await readFile(outputFile, 'utf-8');
      expect(outputContent).toEqual(expectedCursorManualContent);
    });

    it('should report error if input file does not exist', async () => {
      const nonExistentInput = path.join(fixturesDir, 'non-existent-cli.md');
      const { stderr, exitCode } = await execCli([
        '-i',
        nonExistentInput,
        '-o',
        outputFile,
      ]);
      expect(stderr).toContain('Input file not found'); // Placeholder error message
      expect(exitCode).not.toBe(0);
    });

    it('should create output directory for file if it does not exist', async () => {
      const nestedOutputDir = path.join(tempTestDir, 'cli-nested-file-output');
      const nestedOutputFile = path.join(nestedOutputDir, 'output.mdc');
      await rm(nestedOutputDir, { recursive: true, force: true });

      const { stderr, exitCode } = await execCli([
        '-i',
        inputFile,
        '-o',
        nestedOutputFile,
        '-r', // Add reverse flag for Windsurf to Cursor
      ]);
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      const outputContent = await readFile(nestedOutputFile, 'utf-8');
      expect(outputContent).toEqual(expectedCursorManualContent);
      await rm(nestedOutputDir, { recursive: true, force: true });
    });
  });

  describe('directory conversion via CLI', () => {
    const inputSourceDir = path.join(tempTestDir, 'cli-input-dir-source');
    const outputTargetDir = path.join(tempTestDir, 'cli-output-dir-target');
    let expectedCursorAgentContent: string;

    beforeAll(async () => {
      const cursorAgentPath = path.join(fixturesDir, 'agent-cursor.mdc');
      expectedCursorAgentContent = (
        await readFile(cursorAgentPath, 'utf-8')
      ).replace(/\r\n/g, '\n');
    });

    beforeEach(async () => {
      await rm(inputSourceDir, { recursive: true, force: true });
      await rm(outputTargetDir, { recursive: true, force: true });
      await mkdir(inputSourceDir, { recursive: true });
      // Output directory should be created by the CLI tool if it doesn't exist

      const windsurfAgentPath = path.join(fixturesDir, 'agent-windsurf.md'); // from parent scope
      await writeFile(
        path.join(inputSourceDir, 'manual.md'),
        await readFile(windsurfManualPath, 'utf-8')
      );
      await writeFile(
        path.join(inputSourceDir, 'agent.md'),
        await readFile(windsurfAgentPath, 'utf-8')
      );
      await writeFile(path.join(inputSourceDir, 'ignored.txt'), 'text file');
    });

    it('should convert all .md files in a directory using -d and -o options', async () => {
      const { stderr, exitCode } = await execCli([
        '-d',
        inputSourceDir,
        '-o',
        outputTargetDir,
        '-r', // Added -r for Windsurf (.md) to Cursor (.mdc)
      ]);
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);

      const convertedManual = await readFile(
        path.join(outputTargetDir, 'manual.mdc'),
        'utf-8'
      );
      const convertedAgent = await readFile(
        path.join(outputTargetDir, 'agent.mdc'),
        'utf-8'
      );

      expect(convertedManual).toEqual(expectedCursorManualContent);
      expect(convertedAgent).toEqual(expectedCursorAgentContent);
      await expect(
        readFile(path.join(outputTargetDir, 'ignored.txt'))
      ).rejects.toThrow();
      await expect(
        readFile(path.join(outputTargetDir, 'ignored.mdc'))
      ).rejects.toThrow();
    });

    it('should report error if input directory does not exist', async () => {
      const nonExistentDir = path.join(tempTestDir, 'non-existent-cli-dir');
      const { stdout, stderr, exitCode } = await execCli([
        '-d',
        nonExistentDir,
        '-o',
        outputTargetDir,
      ]);
      try {
        // expect(stderr).toContain(
        //   'DEBUG [exitWithError]: Called with message: Input directory not found'
        // );
        // More robust check for the actual error message:
        expect(stderr).toContain(
          `Error (E003): Input directory not found: ${nonExistentDir}`
        );
      } catch (e) {
        console.log(
          '[TEST DEBUG] Test "should report error if input directory does not exist" failed.'
        );
        console.log('[TEST DEBUG] Captured stdout:\n---\n', stdout, '\n---');
        console.log('[TEST DEBUG] Captured stderr:\n---\n', stderr, '\n---');
        console.log(
          '[TEST DEBUG] Captured exitCode:\n---\n',
          exitCode,
          '\n---'
        );
        throw e; // Re-throw the original assertion error
      }
      expect(exitCode).not.toBe(0);
    });

    it('should create output directory for directory conversion if it does not exist', async () => {
      await rm(outputTargetDir, { recursive: true, force: true }); // Ensure it's removed
      const { stderr, exitCode } = await execCli([
        '-d',
        inputSourceDir,
        '-o',
        outputTargetDir,
        '-r', // Added -r for Windsurf (.md) to Cursor (.mdc)
      ]);
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      const convertedManual = await readFile(
        path.join(outputTargetDir, 'manual.mdc'),
        'utf-8'
      );
      expect(convertedManual).toEqual(expectedCursorManualContent);
    });
  });

  describe('CLI help and version flags', () => {
    it('should show help message with --help', async () => {
      const { stdout, stderr, exitCode } = await execCli(['--help']);
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: cuws');
      expect(stdout).toContain('Options:');
      expect(stdout).toContain('--input');
      expect(stdout).toContain('--output');
      expect(stdout).toContain('--dir'); // Corrected from --directory
    });

    it('should show version with --version', async () => {
      const { stdout, stderr, exitCode } = await execCli(['--version']);
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      const packageJsonContent = await readFile(
        path.join(__dirname, '..', 'package.json'),
        'utf-8'
      );
      const { version: pkgVersion } = JSON.parse(packageJsonContent);
      expect(stdout.trim()).toBe(pkgVersion);
    });
  });

  describe('CLI error handling', () => {
    it('should show error if -o is used without -i or -d (invalid stdin/stdout mode)', async () => {
      const { stderr, exitCode } = await execCli(['-o', 'some-output.mdc']);
      // Expect commander's generic error when only -o is provided without a primary input option.
      // Based on previous runs, this seems to be the message commander outputs in this state.
      // Updated to reflect the actual error message from cli.ts after refactoring
      expect(stderr).toContain(
        'Error: Output option (-o) cannot be used without an input option (-i or -d) for stdin/stdout mode.'
      );
      expect(exitCode).not.toBe(0);
    });

    it('should show commander error if directory specified but no output directory (-d implies -o)', async () => {
      const tempSourceDir = path.join(tempTestDir, 'cli-error-src-dir');
      await mkdir(tempSourceDir, { recursive: true });
      const { stderr, exitCode } = await execCli(['-d', tempSourceDir]);
      // Expect our custom error message now that .implies() is removed for this check
      expect(stderr).toContain(
        'Output directory (-o) must be specified when using --dir (-d).'
      );
      expect(exitCode).not.toBe(0);
      await rm(tempSourceDir, { recursive: true, force: true });
    });

    it('should show commander error if both input file and directory are specified (-i conflicts with -d)', async () => {
      const tempSourceDir = path.join(tempTestDir, 'cli-error-src-dir-both');
      await mkdir(tempSourceDir, { recursive: true });
      const dummyOutput = path.join(tempTestDir, 'dummy-out.mdc');
      const { stderr, exitCode } = await execCli([
        '-i',
        windsurfManualPath,
        '-d',
        tempSourceDir,
        '-o',
        dummyOutput,
      ]);
      // Expect commander's default error message, as custom check was removed in favor of .conflicts()
      expect(stderr).toContain(
        "error: option '-i, --input <path>' cannot be used with option '-d, --dir <path>'"
      );
      expect(exitCode).not.toBe(0);
      await rm(tempSourceDir, { recursive: true, force: true });
      await rm(dummyOutput, { force: true });
    });
  });

  describe('Streaming via CLI', () => {
    const inputFile = windsurfManualPath;
    let windsurfManualContent: string;

    beforeAll(async () => {
      // Normalize windsurfManualContent as well if it's used in comparisons
      // where the other side is normalized or expected to be LF.
      // The `echo` command on Windows might produce CRLF.
      // However, the direct comparison is `stdout.trim()).toEqual(expectedCursorManualContent.trim())`
      // and expectedCursorManualContent is already normalized.
      // So, this specific one might not need normalization if `echo` on CI produces LF,
      // or if `trim()` handles mixed line endings well enough before comparison.
      // For safety and consistency, let's normalize it if it's directly used in an echo.
      windsurfManualContent = (await readFile(inputFile, 'utf-8')).replace(
        /\r\n/g,
        '\n'
      );
    });

    it('should convert stdin to stdout', async () => {
      const { stdout, stderr, exitCode } = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | null;
      }>((resolve) => {
        const child = exec(`node "${path.resolve(cliPath)}" -r`, {
          env: { ...process.env },
        });
        let stdoutData = '';
        let stderrData = '';

        child.stdout?.on('data', (data) => {
          stdoutData += data;
        });
        child.stderr?.on('data', (data) => {
          stderrData += data;
        });
        child.on('close', (code) => {
          resolve({ stdout: stdoutData, stderr: stderrData, exitCode: code });
        });
        child.on('error', (err) => {
          resolve({
            stdout: stdoutData,
            stderr: stderrData + err.message,
            exitCode: 1,
          });
        });

        // Write to stdin
        child.stdin?.write(windsurfManualContent);
        child.stdin?.end();
      });

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toEqual(expectedCursorManualContent.trim());
    });

    it('should convert file input to stdout (using -i without -o)', async () => {
      const { stdout, stderr, exitCode } = await execCli([
        '-i',
        inputFile,
        '-r', // Add reverse flag for Windsurf input
      ]);

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toEqual(expectedCursorManualContent.trim()); // Use expectedCursorManualContent
    });

    it('should show help if stdin is empty', async () => {
      const { stdout, stderr, exitCode } = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | null;
      }>((resolve) => {
        const child = exec(`node "${path.resolve(cliPath)}" -r`, {
          env: { ...process.env },
        });
        let stdoutData = '';
        let stderrData = '';

        child.stdout?.on('data', (data) => {
          stdoutData += data;
        });
        child.stderr?.on('data', (data) => {
          stderrData += data;
        });
        child.on('close', (code) => {
          resolve({ stdout: stdoutData, stderr: stderrData, exitCode: code });
        });
        child.on('error', (err) => {
          resolve({
            stdout: stdoutData,
            stderr: stderrData + err.message,
            exitCode: 1,
          });
        });

        // Write empty string to stdin and close it
        child.stdin?.write('');
        child.stdin?.end();
      });

      // Expect the specific error message
      expect(stderr).toContain(
        'Error (E01): Could not determine source format.'
      );
      // Also check that the standard help info follows the error
      expect(stderr).toContain('Run with --help for usage information.');
      expect(exitCode).not.toBe(0); // Should exit with error code
    });
  });
});
