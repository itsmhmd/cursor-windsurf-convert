import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, parse, relative } from 'node:path';
import fastGlob from 'fast-glob';
import { convertRuleContent, detectFormat } from './mapper';
import {
  type ConversionDirection,
  ConversionError,
  type ConvertDirectoryResult,
  type ConvertFileOptions,
} from './types';

/**
 * Converts a rule file content string from one format to another.
 *
 * @param sourceContent The string content of the source rule file.
 * @param direction The direction of conversion ('cw' for Cursor-to-Windsurf, 'wc' for Windsurf-to-Cursor).
 * @param forceFormat Optional override for source format detection ('cursor' or 'windsurf').
 * @returns The string content of the converted rule file.
 * @throws {ConversionError} for parsing errors (E03), unknown format (E01), or mapping errors (E02).
 */
export function convertString(
  sourceContent: string,
  direction: ConversionDirection,
  forceFormat?: 'cursor' | 'windsurf'
): string {
  return convertRuleContent(sourceContent, direction, forceFormat);
}

// --- Helper Functions for convertFile ---

async function _readFileContent(sourcePath: string): Promise<string> {
  try {
    return await readFile(sourcePath, 'utf-8');
  } catch (e: unknown) {
    if (
      typeof e === 'object' &&
      e !== null &&
      (e as { code?: string }).code === 'ENOENT'
    ) {
      throw new ConversionError(`Input file not found: ${sourcePath}`, 'E03');
    }
    throw e; // Re-throw other errors
  }
}

function _determineConversionDirection(
  sourceContent: string,
  sourcePath: string,
  optionsDirection?: ConversionDirection,
  forceFormat?: 'cursor' | 'windsurf'
): ConversionDirection {
  if (optionsDirection) {
    return optionsDirection;
  }

  if (forceFormat) {
    return forceFormat === 'cursor' ? 'cw' : 'wc';
  }

  const detected = detectFormat(sourceContent);
  if (detected === 'cursor') {
    return 'cw';
  }
  if (detected === 'windsurf') {
    return 'wc';
  }
  throw new ConversionError(
    `Could not auto-detect format for ${sourcePath}. Please specify direction or use --force.`,
    'E01'
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ignore for now
async function _resolveDestinationPath(
  sourcePath: string,
  actualDirection: ConversionDirection,
  destinationPath?: string
): Promise<string> {
  if (destinationPath) {
    let finalDestPath = destinationPath;
    try {
      const destStat = await stat(destinationPath);
      if (destStat.isDirectory()) {
        const sourceFilename = basename(sourcePath);
        const newExtension = actualDirection === 'cw' ? '.md' : '.mdc';
        const base = basename(sourceFilename, extname(sourceFilename));
        finalDestPath = join(destinationPath, `${base}${newExtension}`);
      }
    } catch (e: unknown) {
      if (typeof e === 'object' && e !== null) {
        const err = e as { code?: string; message?: string };
        if (err.code !== 'ENOENT') {
          console.warn(
            `Warning checking destinationPath stat: ${err.message || 'Unknown error'}`
          );
        }
      } else {
        console.warn(
          'Warning checking destinationPath stat: Unknown error object'
        );
      }
    }
    return finalDestPath;
  }
  // No destinationPath provided, derive from sourcePath
  const parsedPath = parse(sourcePath);
  const newExtension = actualDirection === 'cw' ? '.md' : '.mdc';
  return join(parsedPath.dir, `${parsedPath.name}${newExtension}`);
}

async function _writeFile(
  destinationPath: string,
  content: string
): Promise<void> {
  try {
    const dirToCreate = dirname(destinationPath);
    await mkdir(dirToCreate, { recursive: true });
    await writeFile(destinationPath, content, 'utf-8');
  } catch (e: unknown) {
    let message = 'Unknown error writing file';
    if (
      typeof e === 'object' &&
      e !== null &&
      'message' in e &&
      typeof e.message === 'string'
    ) {
      message = e.message;
    } else if (e instanceof Error) {
      message = e.message;
    }
    throw new ConversionError(
      `Failed to write output file ${destinationPath}: ${message}`,
      'E03'
    );
  }
}

/**
 * Converts a rule file from one format to another, reading from and writing to the filesystem.
 */
export async function convertFile(
  sourcePath: string,
  destinationPath?: string,
  options?: ConvertFileOptions
): Promise<string> {
  const fileContent = await _readFileContent(sourcePath);

  const actualForceFormat = options?.forceFormat;
  const dryRun = options?.dryRun ?? false;

  const actualDirection = _determineConversionDirection(
    fileContent,
    sourcePath,
    options?.direction,
    actualForceFormat
  );

  const convertedContent = convertString(
    fileContent,
    actualDirection,
    actualForceFormat
  );

  const finalDestinationPath = await _resolveDestinationPath(
    sourcePath,
    actualDirection,
    destinationPath
  );

  if (!dryRun) {
    await _writeFile(finalDestinationPath, convertedContent);
  }

  return finalDestinationPath;
}

/**
 * Converts all rule files within a directory from one format to another.
 */

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ignore for now
export async function convertDirectory(
  sourceDir: string,
  destinationDir: string, // Made non-optional for typical CLI use, API users can adapt
  options?: ConvertFileOptions
): Promise<ConvertDirectoryResult[]> {
  const results: ConvertDirectoryResult[] = [];
  const dryRun = options?.dryRun ?? false;

  try {
    const sourceStat = await stat(sourceDir);
    if (!sourceStat.isDirectory()) {
      throw new ConversionError(
        `Input path is not a directory: ${sourceDir}`,
        'E003'
      );
    }
  } catch (e: unknown) {
    if (
      typeof e === 'object' &&
      e !== null &&
      (e as { code?: string }).code === 'ENOENT'
    ) {
      throw new ConversionError(
        `Input directory not found: ${sourceDir}`,
        'E003'
      );
    }
    if (e instanceof ConversionError) {
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    throw new ConversionError(
      `Error accessing source directory ${sourceDir}: ${message}`,
      'E003'
    );
  }

  try {
    // Ensure destinationDir is created only if not dryRun,
    // or create it regardless as it's a common expectation.
    // For now, creating it always.
    await mkdir(destinationDir, { recursive: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ConversionError(
      `Could not create output directory ${destinationDir}: ${message}`,
      'E003'
    );
  }

  // Glob for both .md and .mdc files
  const globPattern = join(sourceDir, '**/*.{md,mdc}');
  const potentialFiles = await fastGlob(globPattern, {
    onlyFiles: true,
    dot: true,
  });

  if (potentialFiles.length === 0) {
    return [];
  }

  for (const sourceFilePath of potentialFiles) {
    const relativePath = relative(sourceDir, sourceFilePath);
    const parsedSourcePath = parse(sourceFilePath);

    let fileSpecificDirection: ConversionDirection | undefined =
      options?.direction;
    let formatDetectionError: ConversionError | undefined;

    if (!fileSpecificDirection && !options?.forceFormat) {
      // Only detect if no overall direction and not forcing format
      try {
        const fileContentForDetect = await readFile(sourceFilePath, 'utf-8');
        const detectedFormat = detectFormat(fileContentForDetect);
        if (detectedFormat === 'cursor') {
          fileSpecificDirection = 'cw';
        } else if (detectedFormat === 'windsurf') {
          fileSpecificDirection = 'wc';
        } else {
          formatDetectionError = new ConversionError(
            `Could not auto-detect format for ${sourceFilePath}.`,
            'E001' // Use E001 for format detection issues
          );
        }
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        formatDetectionError = new ConversionError(
          `Failed to read file for format detection ${sourceFilePath}: ${error.message}`,
          'E003' // Use E003 for I/O issues
        );
      }
    } else if (options?.forceFormat && !fileSpecificDirection) {
      // If format is forced but direction is not, infer direction
      fileSpecificDirection = options.forceFormat === 'cursor' ? 'cw' : 'wc';
    }

    if (formatDetectionError) {
      results.push({
        sourcePath: sourceFilePath,
        destinationPath: join(destinationDir, relativePath),
        status: 'error',
        error: formatDetectionError,
      });
      continue;
    }

    if (!fileSpecificDirection) {
      // This case should ideally be caught by forceFormat inference or prior detection error
      // Or if options.direction was given but was somehow invalid (though type system should prevent this)
      results.push({
        sourcePath: sourceFilePath,
        destinationPath: join(destinationDir, relativePath),
        status: 'error',
        error: new ConversionError(
          `Internal error: Could not determine conversion direction for ${sourceFilePath}. Ensure 'direction' or 'forceFormat' is valid.`,
          'E001'
        ),
      });
      continue;
    }

    const expectedInputExtension =
      fileSpecificDirection === 'cw' ? '.mdc' : '.md';

    if (parsedSourcePath.ext.toLowerCase() !== expectedInputExtension) {
      results.push({
        sourcePath: sourceFilePath,
        destinationPath: join(destinationDir, relativePath),
        status: 'skipped',
        error: new ConversionError(
          `File extension ${parsedSourcePath.ext} does not match expected input extension ${expectedInputExtension} for conversion direction '${fileSpecificDirection}'.`,
          'E004' // New error code for this specific skip reason
        ),
      });
      continue;
    }

    const newExtension = fileSpecificDirection === 'cw' ? '.md' : '.mdc';
    const destinationFilePath = join(
      destinationDir,
      dirname(relativePath),
      `${parsedSourcePath.name}${newExtension}`
    );

    // Ensure the specific subdirectory for the output file exists
    try {
      await mkdir(dirname(destinationFilePath), { recursive: true });
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      results.push({
        sourcePath: sourceFilePath,
        destinationPath: destinationFilePath,
        status: 'error',
        error: new ConversionError(
          `Could not create subdirectory for ${destinationFilePath}: ${error.message}`,
          'E003'
        ),
      });
      continue;
    }

    if (dryRun) {
      try {
        const sourceContent = await readFile(sourceFilePath, 'utf-8');
        const convertedContent = convertString(
          sourceContent,
          fileSpecificDirection, // Use the determined fileSpecificDirection
          options?.forceFormat // Pass through original forceFormat
        );
        results.push({
          sourcePath: sourceFilePath,
          destinationPath: destinationFilePath,
          status: 'skipped', // 'skipped' because it's a dry run
          content: convertedContent, // Include content for dry run
        });
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        results.push({
          sourcePath: sourceFilePath,
          destinationPath: destinationFilePath,
          status: 'error',
          error:
            error instanceof ConversionError
              ? error
              : new ConversionError(error.message, 'E003'),
        });
      }
    } else {
      try {
        // Call convertFile, passing the determined direction and original forceFormat
        await convertFile(sourceFilePath, destinationFilePath, {
          direction: fileSpecificDirection,
          forceFormat: options?.forceFormat,
          dryRun: false, // Explicitly false for actual conversion
        });
        results.push({
          sourcePath: sourceFilePath,
          destinationPath: destinationFilePath,
          status: 'converted',
        });
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        results.push({
          sourcePath: sourceFilePath,
          destinationPath: destinationFilePath,
          status: 'error',
          error:
            error instanceof ConversionError
              ? error
              : new ConversionError(error.message, 'E03'),
        });
      }
    }
  }
  return results;
}

// --- Export types ---
export type {
  ConversionDirection,
  CursorFrontMatter,
  WindsurfFrontMatter,
  WindsurfTrigger,
  ConvertDirectoryResult,
  ConvertFileOptions,
} from './types';
export { ConversionError } from './types';
