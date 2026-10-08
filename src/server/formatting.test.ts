import { describe, expect, it } from 'bun:test';
import { CodeActionKind, type TextEdit } from 'vscode-languageserver';
import { computeCodeActions } from './codeActions';
import { DEFAULT_FORMAT_SETTINGS, formatDocument, type FormatSettings } from './formatting';
import { ParsedDocument } from './parser';
import { lines } from './testing';

function applyEdits(text: string, edits: TextEdit[]): string {
  const document = new ParsedDocument(text);
  const sorted = [...edits].sort(
    (a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start),
  );
  let result = text;
  for (const edit of sorted) {
    result =
      result.slice(0, document.offsetAt(edit.range.start)) +
      edit.newText +
      result.slice(document.offsetAt(edit.range.end));
  }
  return result;
}

function format(text: string, settings: Partial<FormatSettings> = {}): string {
  return applyEdits(
    text,
    formatDocument(new ParsedDocument(text), { ...DEFAULT_FORMAT_SETTINGS, ...settings }),
  );
}

const MESSY = lines(
  '# Backends   ',
  'dsconfig   create-backend  --backend-name userRoot \\',
  '        --type local-db   --set "base-dn:dc=example,dc=com" \\',
  '  --set enabled:true   ',
  '',
  'set-backend-prop --backend-name userRoot --set db-cache-percent:40',
);

describe('formatDocument', () => {
  it('preserves line breaks while normalizing spacing and indentation', () => {
    expect(format(MESSY)).toBe(
      lines(
        '# Backends',
        'dsconfig create-backend --backend-name userRoot \\',
        '    --type local-db --set "base-dn:dc=example,dc=com" \\',
        '    --set enabled:true',
        '',
        'set-backend-prop --backend-name userRoot --set db-cache-percent:40',
      ),
    );
  });

  it('puts each argument on its own line in multiline layout', () => {
    expect(format(MESSY, { layout: 'multiline', indentSize: 2 })).toBe(
      lines(
        '# Backends',
        'dsconfig create-backend \\',
        '  --backend-name userRoot \\',
        '  --type local-db \\',
        '  --set "base-dn:dc=example,dc=com" \\',
        '  --set enabled:true',
        '',
        'set-backend-prop \\',
        '  --backend-name userRoot \\',
        '  --set db-cache-percent:40',
      ),
    );
  });

  it('joins commands in singleline layout and can add or remove the prefix', () => {
    const joined = format(MESSY, { layout: 'singleline', dsconfigPrefix: 'add' });
    expect(joined.split('\n').slice(1)).toEqual([
      'dsconfig create-backend --backend-name userRoot --type local-db --set "base-dn:dc=example,dc=com" --set enabled:true',
      '',
      'dsconfig set-backend-prop --backend-name userRoot --set db-cache-percent:40',
    ]);
    expect(format(joined, { layout: 'singleline', dsconfigPrefix: 'remove' }).split('\n')[1]).toStartWith(
      'create-backend ',
    );
  });

  it('is idempotent', () => {
    for (const layout of ['preserve', 'multiline', 'singleline'] as const) {
      const once = format(MESSY, { layout });
      expect(format(once, { layout })).toBe(once);
    }
  });

  it('keeps CRLF line endings', () => {
    const text = 'set-backend-prop --backend-name userRoot --set enabled:true\r\n';
    expect(format(text, { layout: 'multiline' })).toBe(
      'set-backend-prop \\\r\n    --backend-name userRoot \\\r\n    --set enabled:true\r\n',
    );
  });

  it('leaves commands with unterminated quotes untouched', () => {
    const text = 'set-backend-prop   --backend-name "userRoot   ';
    expect(format(text, { layout: 'multiline' })).toBe(text);
  });

  it('leaves commands it could change the meaning of untouched', () => {
    const inlineHash = 'set-backend-prop --backend-name userRoot --set enabled:true # enable it';
    const dangling = lines('set-backend-prop   --backend-name userRoot \\', '');
    const commentedOut = lines('set-backend-prop \\', '#  --set a:b \\', '    --backend-name   userRoot');
    for (const text of [inlineHash, dangling, commentedOut]) {
      expect(format(text, { layout: 'multiline' })).toBe(text);
    }
  });

  it('only formats commands within the requested range', () => {
    const text = lines('list-backends   --property  enabled', 'list-backends   --property  enabled');
    const document = new ParsedDocument(text);
    const edits = formatDocument(document, DEFAULT_FORMAT_SETTINGS, {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 5 },
    });
    expect(applyEdits(text, edits)).toBe(
      lines('list-backends   --property  enabled', 'list-backends --property enabled'),
    );
  });
});

describe('computeCodeActions', () => {
  const actionsAt = (text: string, line: number) =>
    computeCodeActions(
      new ParsedDocument(text),
      {
        textDocument: { uri: 'file:///a.dsconfig' },
        range: { start: { line, character: 0 }, end: { line, character: 0 } },
        context: { diagnostics: [] },
      },
      DEFAULT_FORMAT_SETTINGS,
    );

  it('offers to split a single-line command', () => {
    const text = 'set-backend-prop --backend-name userRoot --set enabled:true';
    const [action] = actionsAt(text, 0);
    expect(action.title).toBe('Split command across lines');
    expect(action.kind).toBe(CodeActionKind.RefactorRewrite);
    expect(applyEdits(text, action.edit!.changes!['file:///a.dsconfig'])).toBe(
      lines('set-backend-prop \\', '    --backend-name userRoot \\', '    --set enabled:true'),
    );
  });

  it('offers to join a multi-line command from any of its lines', () => {
    const text = lines('set-backend-prop \\', '    --backend-name userRoot \\', '    --set enabled:true');
    const [action] = actionsAt(text, 2);
    expect(action.title).toBe('Join command onto one line');
    expect(applyEdits(text, action.edit!.changes!['file:///a.dsconfig'])).toBe(
      'set-backend-prop --backend-name userRoot --set enabled:true',
    );
  });

  it('turns diagnostic fixes into quick fixes', () => {
    const edits = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'x' },
    ];
    const actions = computeCodeActions(
      new ParsedDocument('crate-backend'),
      {
        textDocument: { uri: 'file:///a.dsconfig' },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: {
          diagnostics: [
            {
              range: edits[0].range,
              message: 'm',
              data: { fixes: [{ title: 'Fix it', edits, preferred: true }] },
            },
          ],
        },
      },
      DEFAULT_FORMAT_SETTINGS,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ title: 'Fix it', kind: CodeActionKind.QuickFix, isPreferred: true });
  });
});
