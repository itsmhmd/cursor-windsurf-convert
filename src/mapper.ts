import matter from 'gray-matter';
import yaml, { type DumpOptions } from 'js-yaml'; // Import js-yaml to access its schemas
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
    let originalUnquotedGlobValue: string | undefined;

    const customYamlEngine = (rawFrontMatterString: string): object => {
      let processedFrontMatterString = rawFrontMatterString;

      // Regex to find unquoted globs:
      // - ^(globs:\s*): Matches "globs:" at the start of a line, followed by optional whitespace.
      // - ([^"'\s].*?): Captures the glob value. It must not start with a quote or whitespace.
      //                  It captures any character non-greedily until the end of the line.
      // - \s*$: Matches optional trailing whitespace at the end of the line.
      // This regex is imperfect for complex cases but aims to catch common unquoted globs.
      // biome-ignore lint/performance/useTopLevelRegex: nevermind
      const globRegex = /^(globs:\s*)(?!['"])([^#\n][^\n]*?)\s*$/m;
      const match = globRegex.exec(rawFrontMatterString);

      if (match?.[2]) {
        const globValue = match[2].trim();
        // Check if the glob value contains characters that might be misinterpreted by YAML
        // and is not already quoted.
        // biome-ignore lint/performance/useTopLevelRegex: nevermind
        const specialChars = /[*:{}[\],]/; // Characters that often cause issues
        const isQuoted =
          (globValue.startsWith("'") && globValue.endsWith("'")) ||
          (globValue.startsWith('"') && globValue.endsWith('"'));

        if (!isQuoted && specialChars.test(globValue)) {
          originalUnquotedGlobValue = globValue; // Store the original unquoted value
          // Temporarily quote the glob value for parsing
          const quotedGlobValue = `'${globValue.replace(/'/g, "''")}'`; // Escape single quotes within
          processedFrontMatterString = rawFrontMatterString.replace(
            globRegex,
            `$1${quotedGlobValue}`
          );
        }
      }

      const parsedData = yaml.load(processedFrontMatterString, {
        schema: yaml.JSON_SCHEMA, // Keep JSON_SCHEMA, pre-quoting might make it work
      }) as Record<string, unknown> | undefined; // yaml.load can return undefined for empty input

      // If we temporarily quoted the glob, restore the original unquoted value
      // Use optional chaining for parsedData as it can be undefined
      if (originalUnquotedGlobValue && parsedData?.globs) {
        parsedData.globs = originalUnquotedGlobValue;
      }

      // Ensure an object is always returned, as gray-matter expects.
      // If parsedData is undefined (e.g. empty front-matter), return an empty object.
      return parsedData || {};
    };

    const { data, content } = matter(fileContent, {
      engines: {
        yaml: customYamlEngine,
      },
    });

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
    let specificIssue =
      "A colon ':' is likely missing or there's a general syntax error";
    if (message.includes('a colon is missed')) {
      specificIssue =
        "A colon ':' is missing in a key-value pair, or a value is missing after a colon";
    } else if (message.includes('mapping values are not allowed here')) {
      specificIssue =
        'Indentation or a missing colon might be the issue; mapping values are not allowed in this context';
    }

    throw new ConversionError(
      `Invalid YAML front-matter${pathInfo}. ${specificIssue}${lineInfo}. Original error: ${message}`,
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

  // Custom stringify function for js-yaml to control its output
  const customYamlStringify = (data: object): string => {
    const dumpOptions: DumpOptions = {
      lineWidth: -1,
      forceQuotes: false, // Be explicit about not forcing quotes
      styles: {
        '!!str': 'plain', // Force all strings to plain style
      },
      // noCompatMode: true, // Could be useful for other style controls if needed
    };
    // Ensure data is not null/undefined before dumping
    return yaml.dump(data ?? {}, dumpOptions);
  };

  // Dummy parser to satisfy gray-matter's engine type definition for the 'parse' property.
  // This parser won't actually be called by matter.stringify.
  const dummyYamlParse = (input: string): object => {
    try {
      const result = yaml.load(input);
      // Ensure an object is returned, even for non-object YAML or errors
      return typeof result === 'object' && result !== null ? result : {};
    } catch {
      return {}; // Return empty object on error to satisfy type
    }
  };

  // Use the engines option to provide the custom stringifier
  const rawOutput = matter.stringify(content, frontMatter, {
    engines: {
      yaml: {
        parse: dummyYamlParse, // Provide a compliant parser
        stringify: customYamlStringify, // Use our custom stringifier
      },
    },
    language: 'yaml', // Explicitly use the 'yaml' engine defined above
  });

  // Post-process to remove quotes specifically from the 'globs:' line if present
  // This handles cases where js-yaml still quotes globs despite 'plain' style attempt.
  const processedOutput = rawOutput.replace(
    // biome-ignore lint/performance/useTopLevelRegex: nevermind
    /^globs:\s*(['"])(.*?)\1\s*$/m,
    'globs: $2'
  );

  return processedOutput.replace(/\r\n/g, '\n');
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
  // Quick check for Windsurf 'trigger:' in the first few lines for performance
  // Check a bit more than just the first 32 chars to be safer.
  const firstFewLines = fileContent.substring(
    0,
    Math.min(fileContent.length, 512)
  );
  if (firstFewLines.includes(WINDSURF_TRIGGER_KEY)) {
    // WINDSURF_TRIGGER_KEY = 'trigger:'
    return 'windsurf';
  }

  const data = parsedData || parseRuleFileContent(fileContent).data;

  // Windsurf 'trigger' key is the most definitive identifier.
  if ('trigger' in data) {
    // If trigger is present, it's almost certainly Windsurf.
    // The edge case of 'trigger' AND 'alwaysApply' being present
    // likely indicates Windsurf, as 'alwaysApply' is not a Windsurf key.
    return 'windsurf';
  }

  // If no 'trigger', check for Cursor clues.
  // Explicit 'alwaysApply' boolean is a strong indicator.
  if (typeof data[CURSOR_ALWAYS_APPLY_KEY] === 'boolean') {
    return 'cursor';
  }

  // Fallback: If no 'trigger' and no boolean 'alwaysApply',
  // presence of 'globs' or 'description' suggests Cursor.
  if (data.globs !== undefined || data.description !== undefined) {
    return 'cursor';
  }

  // Otherwise, unknown.
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
  let windsurfFm: Partial<WindsurfFrontMatter> = { ...rest };

  if (alwaysApply === true) {
    trigger = 'always_on';
    // Directly construct the object for this case
    windsurfFm = {
      ...rest,
      trigger: 'always_on',
    };
    if (description) {
      windsurfFm.description = description;
    }
    if (globs) {
      windsurfFm.globs = globs;
    }
  } else if (globs) {
    trigger = 'glob';
    windsurfFm = { ...rest, trigger, globs };
    if (description) {
      windsurfFm.description = description;
    }
  } else if (description) {
    trigger = 'model_decision';
    windsurfFm = { ...rest, trigger, description };
    // No globs for model_decision typically
  } else {
    // alwaysApply: false, no globs, no description
    trigger = 'manual';
    windsurfFm = { ...rest, trigger };
  }

  // Clean up fields that are explicitly undefined after construction
  // (Needed because js-yaml doesn't like serializing 'key: undefined')
  if (windsurfFm.description === undefined) {
    // biome-ignore lint/performance/noDelete: Necessary for js-yaml compatibility
    delete windsurfFm.description;
  }
  if (windsurfFm.globs === undefined) {
    // biome-ignore lint/performance/noDelete: Necessary for js-yaml compatibility
    delete windsurfFm.globs;
  }
  // Note: 'trigger' is always set, so no need to delete it if undefined.
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
