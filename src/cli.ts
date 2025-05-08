#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Option, program } from 'commander';
import { version } from '../package.json';
import {
  ConversionError,
  convertDirectory,
  convertFile,
  convertString,
} from './index';
import type { ConversionDirection, ConvertDirectoryResult } from './types';

// Define an interface for options for better type checking, although commander provides its own types
interface CLIOptions {
  input?: string;
  output?: string;
  dir?: string;
  reverse?: boolean;
  force?: 'cursor' | 'windsurf';
  dryRun?: boolean;
  verbose?: boolean;
}

// Helper function for consistent error handling
function exitWithError(message: string, code?: string): never {
  console.error(
    `DEBUG [exitWithError]: Called with message: ${message}, code: ${code}`
  ); // DEBUG LINE
  const prefix = code ? `Error (${code})` : 'Error';
  console.error(`${prefix}: ${message}`);
  console.error('\nRun with --help for usage information.');
  process.exit(1);
}

program
  .name('cuws')
  .version(version)
  .description(
    'Converts rule files between Cursor (.mdc) and Windsurf (.md) formats.'
  )
  .addOption(
    new Option(
      '-i, --input <path>',
      'Input file path (for single file mode). Conflicts with -d/--dir.'
    ).conflicts('dir')
  )
  .addOption(
    new Option(
      '-o, --output <path>',
      'Output file path (used with -i/--input) or output directory (used with -d/--dir).'
    )
  )
  .addOption(
    new Option(
      '-d, --dir <path>',
      'Input directory for batch conversion. Conflicts with -i/--input. Requires -o/--output for output directory.'
    ).conflicts('input')
  )
  .addOption(
    new Option(
      '-r, --reverse',
      'Convert from Windsurf (.md) to Cursor (.mdc)'
    ).default(false)
  )
  .addOption(
    new Option(
      '--force <format>',
      'Force the input format detection (cursor or windsurf)'
    )
  )
  .addOption(
    new Option(
      '--dry-run',
      'Show what would be done without writing files'
    ).default(false)
  )
  .addOption(new Option('--verbose', 'Show detailed output').default(false))
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex logic for CLI
  .action(async (options: CLIOptions) => {
    // Corrected action handler body starts here
    // Directly use options.input for finalInput, options.output for finalOutput
    const {
      input: finalInput,
      output: finalOutput,
      dir: dirInput,
      reverse,
      force,
      dryRun,
      verbose,
    } = options;

    const direction: ConversionDirection = reverse ? 'wc' : 'cw';
    const forceFormat = force as 'cursor' | 'windsurf' | undefined;

    const isDirMode = !!dirInput;
    const isFileMode = !!finalInput; // True if -i is provided

    // --- Custom Validation for specific scenarios not fully covered by commander's declarative syntax ---
    if (isDirMode && !finalOutput) {
      // Rule: If -d is used, -o (finalOutput) must be specified for the output directory.
      // This check is needed because .implies() is more about setting values than strict requirement.
      return exitWithError(
        'Output directory (-o) must be specified when using --dir (-d).'
      );
    }

    if (!isDirMode && !isFileMode) {
      // This implies stdin/stdout mode.
      // If -o was provided without -i or -d, commander might error or we might need to clarify behavior.
      // For now, assume if no -i or -d, it's stdin/stdout.
      // If finalOutput is present here, it means -o was given without -i or -d. This is an invalid combo.
      if (finalOutput) {
        return exitWithError(
          'Output option (-o) cannot be used without an input option (-i or -d) for stdin/stdout mode.'
        );
      }
      if (verbose) {
        console.log(`Stdin/stdout streaming mode:
  Direction: ${direction}${forceFormat ? `\n  Force Format: ${forceFormat}` : ''}`);
      }
      if (dryRun) {
        console.log(
          '[Dry Run] Would process stdin to stdout (logic not implemented).'
        );
      } else {
        // Implement stdin/stdout streaming logic
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          const stdinContent = Buffer.concat(chunks).toString('utf-8');
          if (stdinContent) {
            // Call convertString with forceFormat as the 3rd argument
            const convertedContent = convertString(
              stdinContent,
              direction,
              forceFormat
            );
            process.stdout.write(convertedContent);
          } else {
            // Handle empty stdin case if necessary, maybe show help?
            program.help({ error: true }); // Show help if stdin is empty
            // NOTE: program.help({ error: true }) should exit, but we add else for clarity
          }
        } catch (e) {
          // Handle errors during stdin read or conversion
          if (e instanceof ConversionError) {
            return exitWithError(e.message, e.code);
          }
          if (e instanceof Error) {
            return exitWithError(e.message);
          }
          return exitWithError(
            'An unexpected error occurred during streaming.'
          );
        }
      }
      return; // End execution for stdin/stdout mode
    }

    // At this point, either isDirMode or isFileMode (or both, which commander should prevent via .conflicts)
    // Commander should have already enforced that if isDirMode, finalOutput (options.output) is present due to .implies()
    // If isFileMode, we need to ensure finalOutput is present if we're writing to a file.
    // If isFileMode and no finalOutput, it implies input file to stdout.

    if (isFileMode && !finalOutput && !isDirMode) {
      // isDirMode check is redundant due to conflicts
      // File input to stdout
      if (verbose) {
        console.log(`File to stdout streaming mode:
  Input: ${finalInput}
  Direction: ${direction}${forceFormat ? `\n  Force Format: ${forceFormat}` : ''}`);
      }
      if (dryRun) {
        console.log('[Dry Run] Would convert file to stdout:');
        console.log(`  Input: ${finalInput}`);
        console.log(`  Direction: ${direction}`);
        if (forceFormat) {
          console.log(`  Force Format: ${forceFormat}`);
        }
        // Simulate by trying to get info from convertFile
        try {
          await convertFile(finalInput, undefined /* to stdout */, {
            direction,
            forceFormat,
            dryRun: true,
          });
          console.log('[Dry Run] Operation would likely succeed.');
        } catch (e) {
          if (e instanceof ConversionError) {
            return exitWithError(`(${e.code}) ${e.message}`);
          }
          if (e instanceof Error) {
            return exitWithError(e.message);
          }
          return exitWithError('Unknown error during dry run simulation.');
        }
      } else {
        // Implement file to stdout streaming logic
        try {
          const fileContent = await readFile(finalInput, 'utf-8');
          // Call convertString with forceFormat as the 3rd argument
          const convertedContent = convertString(
            fileContent,
            direction,
            forceFormat
            // Note: filePath cannot be passed to convertString, only convertRuleContent
          );
          process.stdout.write(convertedContent);
        } catch (e) {
          // Handle errors during file read or conversion
          if (e instanceof ConversionError) {
            return exitWithError(e.message, e.code);
          }
          if (e instanceof Error) {
            // Check for file not found error specifically
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
              return exitWithError(`Input file not found: ${finalInput}`);
            }
            return exitWithError(e.message);
          }
          return exitWithError(
            'An unexpected error occurred during streaming.'
          );
        }
      }
      return; // End execution for file-to-stdout mode
    }

    // --- Execution for File or Directory mode with specified output ---
    try {
      if (isDirMode) {
        // Directory Mode Logic
        // Commander ensures options.output (finalOutput) is present due to .implies('output') on -d
        if (verbose) {
          console.log(`Directory conversion mode:
  Input directory: ${dirInput}
  Output directory: ${finalOutput}
  Direction: ${direction}${forceFormat ? `\n  Force Format: ${forceFormat}` : ''}`);
        }
        if (dryRun) {
          console.log('[Dry Run] Would convert directory:');
          console.log(`  Input directory: ${dirInput}`);
          console.log(`  Output directory: ${finalOutput}`);
          console.log(`  Direction: ${direction}`);
          if (forceFormat) {
            console.log(`  Force Format: ${forceFormat}`);
          }
          // Simulate by calling convertDirectory with dryRun: true
          try {
            if (
              typeof dirInput !== 'string' ||
              typeof finalOutput !== 'string'
            ) {
              // This should be unreachable due to prior checks but satisfies strict type analysis
              return exitWithError(
                'Internal error: Missing directory paths for dry run directory mode.'
              );
            }
            const results: ConvertDirectoryResult[] = await convertDirectory(
              dirInput,
              finalOutput,
              { direction, forceFormat, dryRun: true }
            );
            for (const result of results) {
              if (result.status === 'skipped' && result.content) {
                console.log(
                  `  [Dry Run] Would convert ${result.sourcePath} to ${result.destinationPath}`
                );
                // Optionally log content snippet if verbose
                // if (verbose && result.content) {
                //   console.log(`    Content preview:\n${result.content.substring(0, 100)}...`);
                // }
              } else if (result.status === 'error') {
                console.error(
                  `  [Dry Run Error] File ${result.sourcePath}: ${result.error?.message}`
                );
              }
            } // Corrected: Parenthesis moved to the end of the loop block
            if (results.every((r) => r.status === 'skipped')) {
              console.log(
                '[Dry Run] All files would be processed successfully.'
              );
            } else if (results.some((r) => r.status === 'error')) {
              exitWithError(
                'Dry run simulation encountered errors for some files.'
              );
            } else if (results.length === 0) {
              console.log('[Dry Run] No .md files found to convert.');
            }
          } catch (e) {
            if (e instanceof ConversionError) {
              return exitWithError(`(${e.code}) ${e.message}`);
            }
            if (e instanceof Error) {
              return exitWithError(e.message);
            }
            return exitWithError(
              'Unknown error during dry run directory simulation.'
            );
          }
        } else {
          // Actual directory conversion
          const dirOptions = { direction, forceFormat, dryRun: false }; // DEBUG LINE
          if (typeof dirInput !== 'string' || typeof finalOutput !== 'string') {
            // This should be unreachable due to prior checks but satisfies strict type analysis
            return exitWithError(
              'Internal error: Missing directory paths for actual directory mode.'
            );
          }
          console.log(
            `DEBUG [CLI]: Calling convertDirectory with dirInput: ${dirInput}, finalOutput: ${finalOutput}, options:`,
            dirOptions
          ); // DEBUG LINE
          const results: ConvertDirectoryResult[] = await convertDirectory(
            dirInput,
            finalOutput,
            dirOptions
          );
          console.log(
            `DEBUG [CLI]: convertDirectory returned ${results.length} results.`
          ); // DEBUG LINE

          let convertedCount = 0;
          let skippedCount = 0;
          let errorCount = 0;

          for (const result of results) {
            if (result.status === 'converted') {
              convertedCount++;
              if (verbose) {
                console.log(
                  `Successfully converted ${result.sourcePath} to ${result.destinationPath}`
                );
              }
            } else if (result.status === 'error') {
              errorCount++;
              console.error(
                `Error converting ${result.sourcePath}: ${result.error?.message}${result.error instanceof ConversionError && result.error.code ? ` (${result.error.code})` : ''}`
              );
            } else if (result.status === 'skipped') {
              skippedCount++;
              if (verbose && result.error) {
                console.log(
                  `Skipped ${result.sourcePath}: ${result.error.message}`
                );
              } else if (verbose) {
                console.log(`Skipped ${result.sourcePath}`);
              }
            }
          }

          if (results.length > 0 || verbose) {
            console.log(
              `\nConversion summary: ${convertedCount} file(s) converted, ${skippedCount} file(s) skipped, ${errorCount} error(s).`
            );
          } else if (results.length === 0 && !verbose) {
            // No output if no files and not verbose, unless there were errors (handled by errorCount > 0)
          }

          if (errorCount > 0) {
            // Don't use exitWithError here as we've already printed detailed errors
            process.exit(1);
          }
        }
      } else if (isFileMode && finalOutput) {
        // File to File conversion
        // Single File Mode Logic (file to file)
        if (verbose) {
          console.log(`Single file conversion mode (file to file):
  Input: ${finalInput}
  Output: ${finalOutput}
  Direction: ${direction}${forceFormat ? `\n  Force Format: ${forceFormat}` : ''}`);
        }

        if (dryRun) {
          console.log('[Dry Run] Would convert file:');
          console.log(`  Input: ${finalInput}`);
          console.log(`  Output: ${finalOutput}`);
          console.log(`  Direction: ${direction}`);
          if (forceFormat) {
            console.log(`  Force Format: ${forceFormat}`);
          }
          // Simulate by trying to get info from convertFile
          try {
            await convertFile(finalInput, finalOutput, {
              direction,
              forceFormat,
              dryRun: true,
            });
            console.log('[Dry Run] Operation would likely succeed.');
          } catch (e) {
            // Re-throw specific errors for dry-run simulation feedback
            if (e instanceof ConversionError) {
              // Use exitWithError for consistent formatting
              return exitWithError(`(${e.code}) ${e.message}`);
            }
            if (e instanceof Error) {
              return exitWithError(e.message);
            }
            // Default case for unknown errors
            return exitWithError('Unknown error during dry run simulation.');
          }
        } else {
          // Actual conversion (not dry run)
          const finalOutputPath = await convertFile(
            finalInput, // Use original path
            finalOutput, // Use original path
            {
              direction,
              forceFormat,
            }
          );
          if (verbose) {
            console.log(
              `Successfully converted ${finalInput} to ${finalOutputPath}`
            );
          }
        } // Closes 'else if (isFileMode)'
      } // Closes 'try' block for execution logic
    } catch (error) {
      // Catch errors from convertFile/convertDirectory during actual execution
      console.error('DEBUG: Caught error in main action handler:', error); // DEBUG LINE
      if (error instanceof ConversionError) {
        // Use exitWithError for consistent formatting
        return exitWithError(error.message, error.code);
      }
      if (error instanceof Error) {
        return exitWithError(error.message);
      }
      // Default case for unknown errors
      return exitWithError('An unexpected error occurred.');
    } // Closes 'catch' block
  }); // This closes the .action() call

// Add custom error handling for parsing errors (like unknown options)
program.showHelpAfterError('(add --help for additional information)');

program.parse(process.argv);
