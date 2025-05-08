# `cursor-windsurf-convert` API Documentation

This document describes the programmatic API provided by the `cursor-windsurf-convert` package.

## Installation

```bash
# Using pnpm
pnpm add cursor-windsurf-convert

# Using bun
bun add cursor-windsurf-convert

# Using npm
npm install cursor-windsurf-convert

# Using yarn
yarn add cursor-windsurf-convert
```

## Core Functions

### `convertString(sourceContent, direction, forceFormat?)`

Converts a rule file content string from one format to another.

**Parameters:**

*   `sourceContent` (`string`): The string content of the source rule file (including front-matter and body).
*   `direction` (`ConversionDirection`): The direction of conversion:
    *   `'cw'`: Cursor (`.mdc`) to Windsurf (`.md`)
    *   `'wc'`: Windsurf (`.md`) to Cursor (`.mdc`)
*   `forceFormat?` (`'cursor' | 'windsurf'`): Optional. If provided, forces the parser to assume the `sourceContent` is in the specified format, overriding auto-detection.

**Returns:**

*   `string`: The string content of the converted rule file.

**Throws:**

*   `ConversionError`:
    *   `E01`: If the source format cannot be auto-detected and `forceFormat` is not provided.
    *   `E02`: If the metadata combination in the source front-matter is invalid or unsupported for conversion.
    *   `E03`: If the YAML front-matter in `sourceContent` cannot be parsed.

**Example:**

```typescript
import { convertString } from 'cursor-windsurf-convert';

const cursorRule = `---
alwaysApply: true
description: A rule that always applies
globs: src/**/*.ts
---
Rule body here.`;

try {
  const windsurfRule = convertString(cursorRule, 'cw');
  console.log(windsurfRule);
  /* Output:
  ---
  trigger: always_on
  description: A rule that always applies
  globs: src/**/*.ts
  ---
  Rule body here.
  */
} catch (error) {
  console.error(`Conversion failed: ${error.message}`);
}
```

### `convertFile(sourcePath, destinationPath?, options?)`

Converts a rule file from one format to another, reading from and writing to the filesystem.

**Parameters:**

*   `sourcePath` (`string`): The path to the source rule file.
*   `destinationPath?` (`string`): Optional. The path where the converted file should be written.
    *   If omitted, the output file path is derived from `sourcePath` by changing the extension (e.g., `.md` to `.mdc` or vice-versa) in the same directory.
    *   If `destinationPath` is an existing directory, the output file will be created inside that directory with the appropriate name and extension.
    *   If `destinationPath` includes a filename, that path will be used directly.
*   `options?` (`ConvertFileOptions`): Optional object with conversion options:
    *   `direction?` (`ConversionDirection`): `'cw'` or `'wc'`. If omitted, the direction is inferred from the source file content or from `options.forceFormat` if provided.
    *   `forceFormat?` (`'cursor' | 'windsurf'`): Overrides source format auto-detection. If `direction` is also omitted, `forceFormat` will also determine the conversion direction.
    *   `dryRun?` (`boolean`): If `true`, performs all steps except writing the output file. Defaults to `false`.

**Returns:**

*   `Promise<string>`: A promise that resolves with the final destination path of the converted file.

**Throws:**

*   `ConversionError`:
    *   `E01`: If the source format cannot be auto-detected and `options.direction` or `options.forceFormat` is not provided.
    *   `E02`: If the metadata combination is invalid.
    *   `E03`: If the source file cannot be read, YAML cannot be parsed, or the output file/directory cannot be written/created.

**Example:**

```typescript
import { convertFile } from 'cursor-windsurf-convert';

async function convertMyRule() {
  try {
    const outputPath = await convertFile('./rules/myRule.mdc', './converted/myRule.md');
    console.log(`Successfully converted to ${outputPath}`);
  } catch (error) {
    console.error(`Conversion failed: ${error.message}`);
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
  }
}

convertMyRule();
```

### `convertDirectory(sourceDir, destinationDir, options?)`

Recursively converts all compatible rule files (`.md` or `.mdc`) within a source directory to a destination directory, mirroring the structure.

**Parameters:**

*   `sourceDir` (`string`): The path to the source directory containing rule files.
*   `destinationDir` (`string`): The path to the directory where converted files should be written. This directory will be created if it doesn't exist.
*   `options?` (`ConvertFileOptions`): Optional object with conversion options applied to *each file*:
    *   `direction?` (`ConversionDirection`): `'cw'` or `'wc'`. If omitted, the direction is inferred *per file* based on content.
    *   `forceFormat?` (`'cursor' | 'windsurf'`): Overrides source format auto-detection *for all files*. If `direction` is also omitted, the direction is inferred from `forceFormat`.
    *   `dryRun?` (`boolean`): If `true`, performs all steps except writing the output files. Defaults to `false`.

**Returns:**

*   `Promise<ConvertDirectoryResult[]>`: A promise that resolves with an array of `ConvertDirectoryResult` objects. Each object describes the result for a single file processed or skipped. If `options.dryRun` is `true`, successfully processed files will have `status: 'skipped'` and their `content` property will contain the converted string.

**Throws:**

*   `ConversionError`:
    *   `E003`: If `sourceDir` does not exist, is not a directory, or cannot be accessed.
    *   `E003`: If `destinationDir` cannot be created.
    *   *(Note: Errors during individual file conversions within the directory are reported in the returned `ConvertDirectoryResult[]` array, not by throwing from `convertDirectory` itself, unless a fatal setup error occurs).*

**Example:**

```typescript
import { convertDirectory } from 'cursor-windsurf-convert';

async function convertAllRules() {
  try {
    const results = await convertDirectory('./cursor-rules', './windsurf-rules', {
      direction: 'cw' // Convert all from Cursor to Windsurf
    });

    console.log('Directory conversion summary:');
    let converted = 0;
    let skipped = 0;
    let errors = 0;

    for (const result of results) {
      if (result.status === 'converted') {
        converted++;
        console.log(`  Converted: ${result.sourcePath} -> ${result.destinationPath}`);
      } else if (result.status === 'skipped') {
        skipped++;
        console.log(`  Skipped: ${result.sourcePath} (${result.error?.message})`);
      } else if (result.status === 'error') {
        errors++;
        console.error(`  Error: ${result.sourcePath} (${result.error?.message})`);
      }
    }
    console.log(`\nTotal: ${converted} converted, ${skipped} skipped, ${errors} errors.`);

  } catch (error) {
    // Catch errors related to accessing source/destination dirs
    console.error(`Directory conversion failed: ${error.message}`);
  }
}

convertAllRules();
```

## Error Handling

### `ConversionError`

All errors thrown by the API functions are instances of `ConversionError`, which extends the built-in `Error` class.

**Properties:**

*   `message` (`string`): Description of the error.
*   `code?` (`ConversionErrorCode`): Optional error code providing more specific context.

**Error Codes (`ConversionErrorCode`):**

*   `'E01'`: General format detection error (e.g., auto-detection failed for `convertString`, or forced format mismatch). Used by `mapper.ts`.
*   `'E02'`: General mapping error (e.g., invalid/unsupported metadata combination during conversion). Used by `mapper.ts`.
*   `'E03'`: General parsing or I/O error (e.g., invalid YAML in `convertString`, file read/write issues in `convertFile`). Used by `mapper.ts` and `convertFile`.
*   `'E001'`: Format detection error specific to `convertDirectory` when auto-detecting format for an individual file within the directory.
*   `'E002'`: (Defined, but not actively used) Potentially for specific mapping errors if distinguished from the general `E02`.
*   `'E003'`: File I/O or setup error specific to `convertDirectory` (e.g., source/destination directory issues, reading a file for detection, creating subdirectories).
*   `'E004'`: File skipped during `convertDirectory` because its extension does not match the expected input extension for the determined conversion direction.

## Exported Types

The following types are exported for use with the API functions:

*   `ConversionDirection`: `'cw' | 'wc'`
*   `ConvertFileOptions`: `{ direction?: ConversionDirection; forceFormat?: 'cursor' | 'windsurf'; dryRun?: boolean; }`
*   `ConvertDirectoryResult`: `{ sourcePath: string; destinationPath: string; status: 'converted' | 'skipped' | 'error'; error?: Error; content?: string; }`
*   `CursorFrontMatter`: Interface describing Cursor rule front-matter.
*   `WindsurfFrontMatter`: Interface describing Windsurf rule front-matter.
*   `WindsurfTrigger`: `'manual' | 'always_on' | 'model_decision' | 'glob'`
*   `ConversionErrorCode`: Type union of possible error code strings.
*   `ConversionError`: The custom error class.

Refer to `src/types.ts` for detailed interface definitions if needed.
