/**
 * Represents the YAML front-matter structure for Cursor .mdc rule files.
 */
export interface CursorFrontMatter {
  description?: string;
  globs?: string; // Comma-separated string of glob patterns
  alwaysApply?: boolean; // Changed to optional
  [key: string]: unknown; // Allows for other arbitrary keys
}

/**
 * Defines the possible values for the 'trigger' field in Windsurf .md rule files.
 */
export type WindsurfTrigger =
  | 'manual'
  | 'always_on'
  | 'model_decision'
  | 'glob';

/**
 * Represents the YAML front-matter structure for Windsurf .md rule files.
 */
export interface WindsurfFrontMatter {
  trigger: WindsurfTrigger;
  description?: string;
  globs?: string; // Comma-separated string of glob patterns
  [key: string]: unknown; // Allows for other arbitrary keys
}

/**
 * Specifies the direction of conversion.
 * 'cw': Cursor to Windsurf
 * 'wc': Windsurf to Cursor
 */
export type ConversionDirection = 'cw' | 'wc';

/**
 * Represents a parsed rule file, including its front-matter and content.
 * The path is optional and used for context in error messages or logging.
 */
export interface RuleFile {
  frontMatter: Record<string, unknown>; // Generic to hold either Cursor or Windsurf initially
  content: string;
  path?: string;
}

/**
 * Represents the result of a single file conversion, typically used in batch operations.
 */
export interface ConversionResult {
  sourcePath: string;
  destinationPath?: string;
  status: 'success' | 'error' | 'skipped';
  error?: Error;
  message?: string;
}

/**
 * Defines the possible error codes for ConversionError.
 * E001: Format detection error
 * E002: Mapping error (metadata combination) - Retained from PRD, though mapper.ts uses E02
 * E003: File I/O error (read/write/directory creation)
 * E004: File skipped due to mismatched extension for conversion direction
 * E01: General format detection error (used in mapper.ts)
 * E02: General mapping error (used in mapper.ts)
 * E03: General parsing/YAML error (used in mapper.ts)
 */
export type ConversionErrorCode =
  | 'E001'
  | 'E002'
  | 'E003'
  | 'E004'
  | 'E01'
  | 'E02'
  | 'E03';

/**
 * Custom error class for conversion-specific errors.
 * Includes an optional error code.
 */
export class ConversionError extends Error {
  code?: ConversionErrorCode;

  constructor(message: string, code?: ConversionErrorCode) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    // Set the prototype explicitly.
    Object.setPrototypeOf(this, ConversionError.prototype);
  }
}

/**
 * Represents the parsed and validated front-matter along with the original content.
 */
export interface ParsedRule {
  frontMatter: CursorFrontMatter | WindsurfFrontMatter;
  content: string;
  originalFormat: 'cursor' | 'windsurf' | 'unknown';
}

/**
 * Options for the convertFile API function.
 */
export interface ConvertFileOptions {
  direction?: ConversionDirection;
  forceFormat?: 'cursor' | 'windsurf';
  dryRun?: boolean; // Added for CLI dry-run simulation
}

/**
 * Interface representing the command line arguments parsed by yargs.
 * This should align with the options defined in `cli.ts`.
 */
export interface CLIOptions {
  input?: string; // Positional input
  output?: string; // Positional output
  i?: string; // --input option
  o?: string; // --output option
  d?: string; // --dir option
  r?: boolean; // --reverse option
  force?: 'cursor' | 'windsurf';
  'dry-run'?: boolean; // yargs converts to camelCase: dryRun
  dryRun?: boolean; // Explicitly define camelCase version
  verbose?: boolean;
  // Yargs also adds these by default:
  [key: string]: unknown; // For any other properties yargs might add
  _: (string | number)[]; // Positional arguments array
  $0: string; // Script name
}

/**
 * Represents the result of a directory conversion operation for a single file.
 */
export interface ConvertDirectoryResult {
  sourcePath: string;
  destinationPath: string;
  status: 'converted' | 'skipped' | 'error';
  error?: Error;
  content?: string; // Optional: For dry run or verification, actual converted content
}
