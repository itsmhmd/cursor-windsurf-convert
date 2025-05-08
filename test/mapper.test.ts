import { describe, expect, it } from 'vitest';
import {
  convertRuleContent,
  detectFormat,
  mapCursorToWindsurf,
  mapWindsurfToCursor,
  parseRuleFileContent,
  serializeRuleFile,
} from '../src/mapper';
import { ConversionError } from '../src/types';
import type { CursorFrontMatter, WindsurfFrontMatter } from '../src/types';

describe('mapper.ts', () => {
  describe('parseRuleFileContent()', () => {
    it('should parse valid front-matter and content', () => {
      const content = `---
title: Test
value: 123
---
Hello world`;
      const result = parseRuleFileContent(content);
      expect(result.data).toEqual({ title: 'Test', value: 123 });
      expect(result.content.trim()).toBe('Hello world');
    });

    it('should handle content without front-matter', () => {
      const content = 'Just content';
      const result = parseRuleFileContent(content);
      expect(result.data).toEqual({});
      expect(result.content.trim()).toBe('Just content');
    });

    it('should handle empty content', () => {
      const content = '';
      const result = parseRuleFileContent(content);
      expect(result.data).toEqual({});
      expect(result.content.trim()).toBe('');
    });

    it('should handle front-matter only', () => {
      const content = `---
key: value
---`;
      const result = parseRuleFileContent(content);
      expect(result.data).toEqual({ key: 'value' });
      expect(result.content.trim()).toBe('');
    });

    it('should throw ConversionError (E03) for invalid YAML', () => {
      const content = `---
invalid yaml: :
---
Content`;
      let errorThrown: ConversionError | undefined;
      try {
        parseRuleFileContent(content);
      } catch (e) {
        errorThrown = e as ConversionError;
      }
      expect(errorThrown).toBeInstanceOf(ConversionError);
      if (errorThrown) {
        // biome-ignore lint/performance/useTopLevelRegex: test case
        expect(errorThrown.message).toMatch(/YAML front-matter parse failed/);
        expect(errorThrown.code).toBe('E03');
      }
    });

    it('should include file path in E03 error message if provided', () => {
      const content = `---
  invalid yaml: :
---
Content`;
      const filePath = 'test/invalid.md';
      expect(() => parseRuleFileContent(content, filePath)).toThrow(
        `YAML front-matter parse failed at line 2 in file ${filePath}:`
      );
    });
  });

  describe('serializeRuleFile()', () => {
    it('should serialize front-matter and content correctly', () => {
      const frontMatter = { title: 'Hello', count: 42 };
      const content = 'This is the content.';
      const expected = `---
title: Hello
count: 42
---
${content}\n`; // gray-matter adds a trailing newline
      expect(serializeRuleFile(frontMatter, content)).toBe(expected);
    });

    it('should handle empty front-matter', () => {
      const frontMatter = {};
      const content = 'Just content.';
      // gray-matter stringify with empty data doesn't add --- but adds newline to content
      expect(serializeRuleFile(frontMatter, content)).toBe(`${content}\n`);
    });

    it('should handle empty content with front-matter', () => {
      const frontMatter = { key: 'value' };
      const content = '';
      const expected = `---
key: value
---

`; // gray-matter adds two newlines if content is empty but fm exists
      expect(serializeRuleFile(frontMatter, content)).toBe(expected);
    });
  });

  describe('detectFormat()', () => {
    it('should detect Windsurf by "trigger:" in first 32 chars', () => {
      const windsurfContent = `---
trigger: always_on
---
Content`;
      expect(detectFormat(windsurfContent)).toBe('windsurf');
    });

    it('should detect Cursor by "alwaysApply" key in YAML if "trigger:" not in first 32 chars', () => {
      const cursorContent = `---
# some comment to push alwaysApply out of first 32 chars
# ...................................
alwaysApply: true
---
Content`;
      // Simulate that "trigger:" is not in the first 32 chars by checking a longer string
      const first32 = cursorContent.substring(0, 32);
      expect(first32.includes('trigger:')).toBe(false);
      expect(detectFormat(cursorContent)).toBe('cursor');
    });

    it('should detect Windsurf by "trigger" key in YAML as fallback if not in first 32 chars and no "alwaysApply"', () => {
      const windsurfContentFallback = `---
# ...................................
# ...................................
trigger: manual
---
Content`;
      const first32 = windsurfContentFallback.substring(0, 32);
      expect(first32.includes('trigger:')).toBe(false);
      const parsed = parseRuleFileContent(windsurfContentFallback);
      expect(parsed.data.alwaysApply).toBeUndefined();
      expect(detectFormat(windsurfContentFallback, parsed.data)).toBe(
        'windsurf'
      );
    });

    it('should detect Cursor if "alwaysApply" is present, even if "trigger" is also present (Cursor takes precedence if "trigger:" not in first 32)', () => {
      const cursorContent = `---
# ...................................
alwaysApply: false
trigger: manual # This might be some other metadata key in a Cursor file
---
Content`;
      expect(detectFormat(cursorContent)).toBe('cursor');
    });

    it('should return "unknown" if no heuristics match', () => {
      const unknownContent = `---
someOtherKey: value
---
Content`;
      expect(detectFormat(unknownContent)).toBe('unknown');
    });

    it('should correctly use pre-parsed data if provided', () => {
      const windsurfContent = `---
trigger: glob
globs: '*.ts'
---
Content`;
      const { data } = parseRuleFileContent(windsurfContent);
      // Test with content that would otherwise be unknown if not for pre-parsed data
      expect(detectFormat("Content that doesn't match heuristics", data)).toBe(
        'windsurf'
      );

      const cursorContent = `---
alwaysApply: true
---
Content`;
      const { data: cursorData } = parseRuleFileContent(cursorContent);
      expect(
        detectFormat("Content that doesn't match heuristics", cursorData)
      ).toBe('cursor');
    });
  });

  describe('mapCursorToWindsurf()', () => {
    it('should map Cursor "alwaysApply: true" to Windsurf "always_on"', () => {
      const cursorFm: CursorFrontMatter = {
        alwaysApply: true,
        otherKey: 'value',
      };
      const expectedWindsurfFm: WindsurfFrontMatter = {
        trigger: 'always_on',
        otherKey: 'value',
      };
      expect(mapCursorToWindsurf(cursorFm)).toEqual(expectedWindsurfFm);
    });

    it('should map Cursor "alwaysApply: true" with description and globs to Windsurf "always_on", preserving description and globs', () => {
      const cursorFm: CursorFrontMatter = {
        alwaysApply: true,
        description: 'Test desc',
        globs: '*.ts',
        otherKey: 'value',
      };
      const expectedWindsurfFm: WindsurfFrontMatter = {
        trigger: 'always_on',
        description: 'Test desc',
        globs: '*.ts',
        otherKey: 'value',
      };
      expect(mapCursorToWindsurf(cursorFm)).toEqual(expectedWindsurfFm);
    });

    it('should map Cursor "manual" (alwaysApply: false, no globs, no description) to Windsurf "manual"', () => {
      const cursorFm: CursorFrontMatter = {
        alwaysApply: false,
        otherKey: 'data',
      };
      const expectedWindsurfFm: WindsurfFrontMatter = {
        trigger: 'manual',
        otherKey: 'data',
      };
      expect(mapCursorToWindsurf(cursorFm)).toEqual(expectedWindsurfFm);
    });

    it('should map Cursor "glob" (globs present) to Windsurf "glob", copying globs', () => {
      const cursorFm: CursorFrontMatter = {
        alwaysApply: false,
        globs: 'src/*.js',
        otherKey: 'globData',
      };
      const expectedWindsurfFm: WindsurfFrontMatter = {
        trigger: 'glob',
        globs: 'src/*.js',
        otherKey: 'globData',
      };
      expect(mapCursorToWindsurf(cursorFm)).toEqual(expectedWindsurfFm);
    });

    it('should map Cursor "glob" (globs present) with description to Windsurf "glob", copying globs and description', () => {
      const cursorFm: CursorFrontMatter = {
        alwaysApply: false, // or true, globs take precedence for 'glob' trigger type
        globs: 'src/*.js',
        description: 'Glob rule',
        otherKey: 'globData',
      };
      const expectedWindsurfFm: WindsurfFrontMatter = {
        trigger: 'glob',
        globs: 'src/*.js',
        description: 'Glob rule',
        otherKey: 'globData',
      };
      expect(mapCursorToWindsurf(cursorFm)).toEqual(expectedWindsurfFm);
    });

    it('should map Cursor "model_decision" (description present, no globs, alwaysApply: false) to Windsurf "model_decision", copying description', () => {
      const cursorFm: CursorFrontMatter = {
        alwaysApply: false,
        description: 'Agent requested rule',
        otherKey: 'agentData',
      };
      const expectedWindsurfFm: WindsurfFrontMatter = {
        trigger: 'model_decision',
        description: 'Agent requested rule',
        otherKey: 'agentData',
      };
      expect(mapCursorToWindsurf(cursorFm)).toEqual(expectedWindsurfFm);
    });

    it('should correctly remove undefined description or globs if not present in source', () => {
      const cursorFm1: CursorFrontMatter = { alwaysApply: true };
      const expected1: WindsurfFrontMatter = { trigger: 'always_on' };
      expect(mapCursorToWindsurf(cursorFm1)).toEqual(expected1);

      const cursorFm2: CursorFrontMatter = {
        alwaysApply: false,
        description: 'desc only',
      };
      const expected2: WindsurfFrontMatter = {
        trigger: 'model_decision',
        description: 'desc only',
      };
      expect(mapCursorToWindsurf(cursorFm2)).toEqual(expected2);

      const cursorFm3: CursorFrontMatter = {
        alwaysApply: false,
        globs: 'globs only',
      };
      const expected3: WindsurfFrontMatter = {
        trigger: 'glob',
        globs: 'globs only',
      };
      expect(mapCursorToWindsurf(cursorFm3)).toEqual(expected3);
    });
  });

  describe('mapWindsurfToCursor()', () => {
    it('should map Windsurf "always_on" to Cursor "alwaysApply: true"', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'always_on',
        otherKey: 'value',
      };
      const expectedCursorFm: CursorFrontMatter = {
        alwaysApply: true,
        otherKey: 'value',
      };
      expect(mapWindsurfToCursor(windsurfFm)).toEqual(expectedCursorFm);
    });

    it('should map Windsurf "always_on" with description and globs to Cursor "alwaysApply: true", preserving description and globs', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'always_on',
        description: 'Test desc',
        globs: '*.ts',
        otherKey: 'value',
      };
      const expectedCursorFm: CursorFrontMatter = {
        alwaysApply: true,
        description: 'Test desc',
        globs: '*.ts',
        otherKey: 'value',
      };
      expect(mapWindsurfToCursor(windsurfFm)).toEqual(expectedCursorFm);
    });

    it('should map Windsurf "manual" to Cursor "alwaysApply: false"', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'manual',
        otherKey: 'data',
      };
      const expectedCursorFm: CursorFrontMatter = {
        alwaysApply: false,
        otherKey: 'data',
      };
      expect(mapWindsurfToCursor(windsurfFm)).toEqual(expectedCursorFm);
    });

    it('should map Windsurf "glob" to Cursor "alwaysApply: false", copying globs', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'glob',
        globs: 'src/*.js',
        otherKey: 'globData',
      };
      const expectedCursorFm: CursorFrontMatter = {
        alwaysApply: false,
        globs: 'src/*.js',
        otherKey: 'globData',
      };
      expect(mapWindsurfToCursor(windsurfFm)).toEqual(expectedCursorFm);
    });

    it('should map Windsurf "glob" with description to Cursor "alwaysApply: false", copying globs and description', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'glob',
        globs: 'src/*.js',
        description: 'Glob rule',
        otherKey: 'globData',
      };
      const expectedCursorFm: CursorFrontMatter = {
        alwaysApply: false,
        globs: 'src/*.js',
        description: 'Glob rule',
        otherKey: 'globData',
      };
      expect(mapWindsurfToCursor(windsurfFm)).toEqual(expectedCursorFm);
    });

    it('should throw ConversionError (E02) if Windsurf "glob" trigger is missing "globs" field', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'glob',
        description: 'Missing globs',
      } as unknown as WindsurfFrontMatter;
      let errorThrown: ConversionError | undefined;
      try {
        mapWindsurfToCursor(windsurfFm);
      } catch (e) {
        errorThrown = e as ConversionError;
      }
      expect(errorThrown).toBeInstanceOf(ConversionError);
      if (errorThrown) {
        expect(errorThrown.message).toBe(
          "Windsurf 'glob' trigger missing 'globs' field."
        );
        expect(errorThrown.code).toBe('E02');
      }
    });

    it('should map Windsurf "model_decision" to Cursor "alwaysApply: false", copying description', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'model_decision',
        description: 'Agent requested rule',
        otherKey: 'agentData',
      };
      const expectedCursorFm: CursorFrontMatter = {
        alwaysApply: false,
        description: 'Agent requested rule',
        otherKey: 'agentData',
      };
      expect(mapWindsurfToCursor(windsurfFm)).toEqual(expectedCursorFm);
    });

    it('should throw ConversionError (E02) if Windsurf "model_decision" trigger is missing "description" field', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'model_decision',
        globs: 'no-desc.ts',
      } as unknown as WindsurfFrontMatter;
      let errorThrown: ConversionError | undefined;
      try {
        mapWindsurfToCursor(windsurfFm);
      } catch (e) {
        errorThrown = e as ConversionError;
      }
      expect(errorThrown).toBeInstanceOf(ConversionError);
      if (errorThrown) {
        expect(errorThrown.message).toBe(
          "Windsurf 'model_decision' trigger missing 'description' field."
        );
        expect(errorThrown.code).toBe('E02');
      }
    });

    it('should throw ConversionError (E02) for unknown Windsurf trigger type', () => {
      const windsurfFm: WindsurfFrontMatter = {
        trigger: 'unknown_trigger' as unknown as WindsurfFrontMatter['trigger'],
      };
      let errorThrown: ConversionError | undefined;
      try {
        mapWindsurfToCursor(windsurfFm);
      } catch (e) {
        errorThrown = e as ConversionError;
      }
      expect(errorThrown).toBeInstanceOf(ConversionError);
      if (errorThrown) {
        expect(errorThrown.message).toBe(
          'Unknown Windsurf trigger type: unknown_trigger'
        );
        expect(errorThrown.code).toBe('E02');
      }
    });

    it('should correctly remove undefined description or globs if not present in source', () => {
      const windsurfFm1: WindsurfFrontMatter = { trigger: 'always_on' };
      const expected1: CursorFrontMatter = { alwaysApply: true };
      expect(mapWindsurfToCursor(windsurfFm1)).toEqual(expected1);

      const windsurfFm2: WindsurfFrontMatter = {
        trigger: 'model_decision',
        description: 'desc only',
      };
      const expected2: CursorFrontMatter = {
        alwaysApply: false,
        description: 'desc only',
      };
      expect(mapWindsurfToCursor(windsurfFm2)).toEqual(expected2);

      const windsurfFm3: WindsurfFrontMatter = {
        trigger: 'glob',
        globs: 'globs only',
      };
      const expected3: CursorFrontMatter = {
        alwaysApply: false,
        globs: 'globs only',
      };
      expect(mapWindsurfToCursor(windsurfFm3)).toEqual(expected3);
    });
  });

  describe('convertRuleContent()', () => {
    const cursorManualContent = `---
alwaysApply: false
---
Manual Cursor Rule`;

    const windsurfManualContent = `---
trigger: manual
---
Manual Cursor Rule\n`; // Serialized output has newline

    const cursorAlwaysOnContent = `---
alwaysApply: true
description: Always on!
---
Always On Cursor Rule`;

    const windsurfAlwaysOnContent = `---
trigger: always_on
description: Always on!
---
Always On Cursor Rule\n`; // Serialized output has newline

    const cursorGlobContent = `---
alwaysApply: false
globs: '*.md'
---
Glob Cursor Rule`;

    const windsurfGlobContent = `---
trigger: glob
globs: '*.md'
---
Glob Cursor Rule\n`; // Serialized output has newline

    const cursorModelDecisionContent = `---
alwaysApply: false
description: Model decision rule
---
Model Decision Cursor Rule`;

    const windsurfModelDecisionContent = `---
trigger: model_decision
description: Model decision rule
---
Model Decision Cursor Rule\n`; // Serialized output has newline

    it('should convert Cursor to Windsurf (cw)', () => {
      // Manual
      const actualManual = convertRuleContent(cursorManualContent, 'cw');
      const parsedManualActual = parseRuleFileContent(actualManual);
      const parsedManualExpected = parseRuleFileContent(windsurfManualContent);
      expect(parsedManualActual.data).toEqual(parsedManualExpected.data);
      expect(parsedManualActual.content).toEqual(parsedManualExpected.content);

      // Always On
      const actualAlwaysOn = convertRuleContent(cursorAlwaysOnContent, 'cw');
      const parsedAlwaysOnActual = parseRuleFileContent(actualAlwaysOn);
      const parsedAlwaysOnExpected = parseRuleFileContent(
        windsurfAlwaysOnContent
      );
      expect(parsedAlwaysOnActual.data).toEqual(parsedAlwaysOnExpected.data);
      expect(parsedAlwaysOnActual.content).toEqual(
        parsedAlwaysOnExpected.content
      );

      // Glob
      const actualGlob = convertRuleContent(cursorGlobContent, 'cw');
      const parsedGlobActual = parseRuleFileContent(actualGlob);
      const parsedGlobExpected = parseRuleFileContent(windsurfGlobContent);
      expect(parsedGlobActual.data).toEqual(parsedGlobExpected.data);
      expect(parsedGlobActual.content).toEqual(parsedGlobExpected.content);

      // Model Decision
      const actualModel = convertRuleContent(cursorModelDecisionContent, 'cw');
      const parsedModelActual = parseRuleFileContent(actualModel);
      const parsedModelExpected = parseRuleFileContent(
        windsurfModelDecisionContent
      );
      expect(parsedModelActual.data).toEqual(parsedModelExpected.data);
      expect(parsedModelActual.content).toEqual(parsedModelExpected.content);
    });

    it('should convert Windsurf to Cursor (wc)', () => {
      // For WC, the expected output (Cursor format) should also end with a newline due to serialization
      // Manual
      const actualManual = convertRuleContent(windsurfManualContent, 'wc');
      const parsedManualActual = parseRuleFileContent(actualManual);
      const parsedManualExpected = parseRuleFileContent(
        `${cursorManualContent}\n`
      ); // Add newline for comparison
      expect(parsedManualActual.data).toEqual(parsedManualExpected.data);
      expect(parsedManualActual.content).toEqual(parsedManualExpected.content);

      // Always On
      const actualAlwaysOn = convertRuleContent(windsurfAlwaysOnContent, 'wc');
      const parsedAlwaysOnActual = parseRuleFileContent(actualAlwaysOn);
      const parsedAlwaysOnExpected = parseRuleFileContent(
        `${cursorAlwaysOnContent}\n`
      ); // Add newline
      expect(parsedAlwaysOnActual.data).toEqual(parsedAlwaysOnExpected.data);
      expect(parsedAlwaysOnActual.content).toEqual(
        parsedAlwaysOnExpected.content
      );

      // Glob
      const actualGlob = convertRuleContent(windsurfGlobContent, 'wc');
      const parsedGlobActual = parseRuleFileContent(actualGlob);
      const parsedGlobExpected = parseRuleFileContent(`${cursorGlobContent}\n`); // Add newline
      expect(parsedGlobActual.data).toEqual(parsedGlobExpected.data);
      expect(parsedGlobActual.content).toEqual(parsedGlobExpected.content);

      // Model Decision
      const actualModel = convertRuleContent(
        windsurfModelDecisionContent,
        'wc'
      );
      const parsedModelActual = parseRuleFileContent(actualModel);
      const parsedModelExpected = parseRuleFileContent(
        `${cursorModelDecisionContent}\n`
      ); // Add newline
      expect(parsedModelActual.data).toEqual(parsedModelExpected.data);
      expect(parsedModelActual.content).toEqual(parsedModelExpected.content);
    });

    it('should use forced format correctly (cw)', () => {
      // Content is Windsurf, but we force detection as Cursor (which would normally fail detection)
      // This test is more about ensuring the forced path is taken, not that it's a logical conversion
      const windsurfLikeCursor = `---
alwaysApply: false
trigger: manual # This would make it look like Windsurf if not for alwaysApply
---
Content`;
      const expectedWindsurfFromForcedCursor = `---
trigger: manual
---
Content\n`;
      expect(convertRuleContent(windsurfLikeCursor, 'cw', 'cursor')).toBe(
        expectedWindsurfFromForcedCursor
      );
    });

    it('should use forced format correctly (wc)', () => {
      // Content is Cursor, but we force detection as Windsurf
      const cursorLikeWindsurf = `---
trigger: always_on # This would make it look like Cursor if not for trigger
alwaysApply: true
---
Content`;
      const expectedCursorFromForcedWindsurf = `---
alwaysApply: true
---
Content\n`;
      expect(convertRuleContent(cursorLikeWindsurf, 'wc', 'windsurf')).toBe(
        expectedCursorFromForcedWindsurf
      );
    });

    it('should throw E01 if format is unknown and not forced', () => {
      const unknownContent = `---
key: value
---
Unknown`;
      let errorThrown: ConversionError | undefined;
      try {
        convertRuleContent(unknownContent, 'cw');
      } catch (e) {
        errorThrown = e as ConversionError;
      }
      expect(errorThrown).toBeInstanceOf(ConversionError);
      if (errorThrown) {
        expect(errorThrown.message).toMatch(
          // biome-ignore lint/performance/useTopLevelRegex: not relevant here
          /Could not determine source format/
        );
        expect(errorThrown.code).toBe('E01');
      }
    });

    it('should throw E01 if forced format does not match actual conversion direction requirement (cw)', () => {
      // Trying to convert CW, but forcing source as Windsurf
      let errorThrown: ConversionError | undefined;
      try {
        convertRuleContent(windsurfManualContent, 'cw', 'windsurf');
      } catch (e) {
        errorThrown = e as ConversionError;
      }
      expect(errorThrown).toBeInstanceOf(ConversionError);
      if (errorThrown) {
        expect(errorThrown.message).toMatch(
          // biome-ignore lint/performance/useTopLevelRegex: not relevant here
          /Expected Cursor format but detected windsurf/
        );
        expect(errorThrown.code).toBe('E01');
      }
    });

    it('should throw E01 if forced format does not match actual conversion direction requirement (wc)', () => {
      // Trying to convert WC, but forcing source as Cursor
      let errorThrown: ConversionError | undefined;
      try {
        convertRuleContent(cursorManualContent, 'wc', 'cursor');
      } catch (e) {
        errorThrown = e as ConversionError;
      }
      expect(errorThrown).toBeInstanceOf(ConversionError);
      if (errorThrown) {
        expect(errorThrown.message).toMatch(
          // biome-ignore lint/performance/useTopLevelRegex: not relevant here
          /Expected Windsurf format but detected cursor/
        );
        expect(errorThrown.code).toBe('E01');
      }
    });

    it('should include filePath in E01 error messages', () => {
      const unknownContent = `---
key: value
---
Unknown`;
      const filePath = 'test/unknown.md';
      expect(() =>
        convertRuleContent(unknownContent, 'cw', undefined, filePath)
      ).toThrow(
        `Could not determine source format for file ${filePath}. Use --force if necessary.`
      );

      expect(() =>
        convertRuleContent(windsurfManualContent, 'cw', 'windsurf', filePath)
      ).toThrow(
        `Expected Cursor format but detected windsurf for file ${filePath}. Use --force if necessary.`
      );

      expect(() =>
        convertRuleContent(cursorManualContent, 'wc', 'cursor', filePath)
      ).toThrow(
        `Expected Windsurf format but detected cursor for file ${filePath}. Use --force if necessary.`
      );
    });
  });
});
