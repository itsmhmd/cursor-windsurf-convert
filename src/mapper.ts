import matter from 'gray-matter';
import type {
  ConversionDirection,
  CursorFrontMatter,
  WindsurfFrontMatter,
  WindsurfTrigger,
} from './types';
import { ConversionError } from './types';

const CURSOR_ALWAYS_APPLY_KEY = 'alwaysApply';
const WINDSURF_TRIGGER_KEY = 'trigger:';

/**
 * Parses a rule file string into front-matter and content.
 * @param fileContent The string content of the rule file.
 * @param filePath Optional path of the file for error context.
 * @returns An object containing the parsed data and content.
 * @throws {ConversionError} if YAML parsing fails (E03).
 */
export function parseRuleFileContent(
  fileContent: string,
  filePath?: string
): { data: Record<string, unknown>; content: string } {
  try {
    const { data, content } = matter(fileContent);
    return { data, content };
  } catch (e: unknown) {
    let message = 'Unknown YAML parsing error';
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

    let lineInfo = '';
    if (
      typeof e === 'object' &&
      e !== null &&
      'mark' in e &&
      typeof e.mark === 'object' &&
      e.mark !== null &&
      'line' in e.mark &&
      typeof (e.mark as { line?: number }).line === 'number'
    ) {
      lineInfo = ` at line ${(e.mark as { line: number }).line + 1}`;
    }
    const pathInfo = filePath ? ` in file ${filePath}` : '';
    throw new ConversionError(
      `YAML front-matter parse failed${lineInfo}${pathInfo}: ${message}`,
      'E03'
    );
  }
}

/**
 * Serializes front-matter and content back into a rule file string.
 * @param frontMatter The front-matter object.
 * @param content The Markdown content.
 * @returns A string representation of the rule file.
 */
export function serializeRuleFile(
  frontMatter: Record<string, unknown>,
  content: string
): string {
  // Ensure consistent key order for determinism if possible, though gray-matter might not guarantee it.
  // For now, direct stringification is used.
  // biome-ignore lint/suspicious/noExplicitAny: gray-matter's stringify expects `{[key: string]: any;}` for data.
  return matter.stringify(content, frontMatter as any);
}

/**
 * Detects the format of a rule file based on its content.
 * Heuristic:
 * 1. Inspect first 32 chars for `trigger:` -> Windsurf.
 * 2. Else parse YAML keys: `alwaysApply` -> Cursor.
 * @param fileContent The string content of the rule file.
 * @param parsedData Optional pre-parsed front-matter data.
 * @returns 'cursor', 'windsurf', or 'unknown'.
 */
export function detectFormat(
  fileContent: string,
  parsedData?: Record<string, unknown>
): 'cursor' | 'windsurf' | 'unknown' {
  const first32Chars = fileContent.substring(0, 32);
  if (first32Chars.includes(WINDSURF_TRIGGER_KEY)) {
    return 'windsurf';
  }

  const data = parsedData || parseRuleFileContent(fileContent).data;
  if (CURSOR_ALWAYS_APPLY_KEY in data) {
    return 'cursor';
  }

  // Fallback: if trigger is present in data, it's likely Windsurf (e.g. if not in first 32 chars)
  if ('trigger' in data) {
    return 'windsurf';
  }

  return 'unknown';
}

/**
 * Maps Cursor front-matter to Windsurf front-matter.
 * @param cursorFm The Cursor front-matter.
 * @returns The corresponding Windsurf front-matter.
 * @throws {ConversionError} if the metadata combination is unsupported (E02).
 */
export function mapCursorToWindsurf(
  cursorFm: CursorFrontMatter
): WindsurfFrontMatter {
  const { alwaysApply, description, globs, ...rest } = cursorFm;
  let trigger: WindsurfTrigger;
  const windsurfFm: Partial<WindsurfFrontMatter> = { ...rest };

  if (alwaysApply === true) {
    trigger = 'always_on';
  } else if (globs) {
    trigger = 'glob';
    windsurfFm.globs = globs;
  } else if (description) {
    trigger = 'model_decision';
    windsurfFm.description = description;
  } else {
    // alwaysApply: false, no globs, no description
    trigger = 'manual';
  }

  // Clean up undefined fields that might have been copied if they were undefined in cursorFm
  if (description === undefined) {
    // biome-ignore lint/performance/noDelete: Necessary for js-yaml compatibility (cannot serialize undefined)
    delete windsurfFm.description;
  }
  if (globs === undefined) {
    // biome-ignore lint/performance/noDelete: Necessary for js-yaml compatibility (cannot serialize undefined)
    delete windsurfFm.globs;
  }

  // Ensure description is copied if it exists and wasn't the primary trigger determinant
  if (description && trigger !== 'model_decision') {
    windsurfFm.description = description;
  }
  // Ensure globs are copied if they exist and wasn't the primary trigger determinant
  if (globs && trigger !== 'glob') {
    windsurfFm.globs = globs;
  }

  windsurfFm.trigger = trigger;
  return windsurfFm as WindsurfFrontMatter;
}

/**
 * Maps Windsurf front-matter to Cursor front-matter.
 * @param windsurfFm The Windsurf front-matter.
 * @returns The corresponding Cursor front-matter.
 * @throws {ConversionError} if the metadata combination is unsupported (E02).
 */
export function mapWindsurfToCursor(
  windsurfFm: WindsurfFrontMatter
): CursorFrontMatter {
  const { trigger, description, globs, ...rest } = windsurfFm;
  const cursorFm: Partial<CursorFrontMatter> = { ...rest };

  switch (trigger) {
    case 'always_on':
      cursorFm.alwaysApply = true;
      break;
    case 'manual':
      cursorFm.alwaysApply = false;
      break;
    case 'glob': {
      cursorFm.alwaysApply = false;
      if (globs) {
        cursorFm.globs = globs;
      } else {
        throw new ConversionError(
          "Windsurf 'glob' trigger missing 'globs' field.",
          'E02'
        );
      }
      break;
    }
    case 'model_decision': {
      cursorFm.alwaysApply = false;
      if (description) {
        cursorFm.description = description;
      } else {
        throw new ConversionError(
          "Windsurf 'model_decision' trigger missing 'description' field.",
          'E02'
        );
      }
      break;
    }
    default:
      // This case should ideally be caught by TypeScript's type checking for WindsurfTrigger
      throw new ConversionError(
        `Unknown Windsurf trigger type: ${trigger}`,
        'E02'
      );
  }

  // Copy description and globs if they exist and aren't the primary determinant
  if (description && trigger !== 'model_decision') {
    cursorFm.description = description;
  }
  if (globs && trigger !== 'glob') {
    cursorFm.globs = globs;
  }

  // Clean up undefined fields
  if (cursorFm.description === undefined) {
    // biome-ignore lint/performance/noDelete: Necessary for js-yaml compatibility (cannot serialize undefined)
    delete cursorFm.description;
  }
  if (cursorFm.globs === undefined) {
    // biome-ignore lint/performance/noDelete: Necessary for js-yaml compatibility (cannot serialize undefined)
    delete cursorFm.globs;
  }

  return cursorFm as CursorFrontMatter;
}

/**
 * Converts the content of a rule file from one format to another.
 * @param sourceContent The string content of the source rule file.
 * @param direction The direction of conversion ('cw' or 'wc').
 * @param forceFormat Optional override for source format detection.
 * @param filePath Optional path of the file for error context.
 * @returns The string content of the converted rule file.
 * @throws {ConversionError} for parsing errors (E03), unknown format (E01), or mapping errors (E02).
 */
export function convertRuleContent(
  sourceContent: string,
  direction: ConversionDirection,
  forceFormat?: 'cursor' | 'windsurf',
  filePath?: string
): string {
  const { data: rawFrontMatter, content } = parseRuleFileContent(
    sourceContent,
    filePath
  );

  const detectedSourceFormat =
    forceFormat || detectFormat(sourceContent, rawFrontMatter);

  if (detectedSourceFormat === 'unknown') {
    throw new ConversionError(
      `Could not determine source format${filePath ? ` for file ${filePath}` : ''}. Use --force if necessary.`,
      'E01'
    );
  }

  let targetFrontMatter: CursorFrontMatter | WindsurfFrontMatter;

  if (direction === 'cw' && detectedSourceFormat === 'cursor') {
    // Cursor to Windsurf
    targetFrontMatter = mapCursorToWindsurf(
      rawFrontMatter as CursorFrontMatter
    );
  } else if (direction === 'wc' && detectedSourceFormat === 'windsurf') {
    // Windsurf to Cursor
    targetFrontMatter = mapWindsurfToCursor(
      rawFrontMatter as WindsurfFrontMatter
    );
  } else {
    // Handle cases where detectedSourceFormat is known but doesn't match the required format for the conversion direction.
    // The 'unknown' case is already handled by the 'if' block above.
    const expectedFormat = direction === 'cw' ? 'Cursor' : 'Windsurf';
    throw new ConversionError(
      `Expected ${expectedFormat} format but detected ${detectedSourceFormat}${filePath ? ` for file ${filePath}` : ''}. Use --force if necessary.`,
      'E01'
    );
  }

  return serializeRuleFile(targetFrontMatter, content);
}
