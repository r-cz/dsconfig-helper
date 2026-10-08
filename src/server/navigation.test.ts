import { describe, expect, it } from 'bun:test';
import {
  DocumentHighlightKind,
  FoldingRangeKind,
  MarkupKind,
  SymbolKind,
  type MarkupContent,
} from 'vscode-languageserver';
import { Catalog } from './catalog';
import { computeHover } from './hover';
import { documentHighlights, findDefinition, findReferences, prepareRename, rename } from './navigation';
import { quoteName } from './quoting';
import { ParsedDocument } from './parser';
import { documentSymbols, foldingRanges, workspaceSymbols } from './symbols';
import { indexOf, lines, withCursor } from './testing';

const BACKENDS = lines(
  '# region Backends',
  'dsconfig create-backend \\',
  '    --backend-name userRoot \\',
  '    --type local-db',
  'dsconfig create-local-db-index --backend-name userRoot --index-name cn --set index-type:equality',
  '# endregion',
);
const POLICIES = lines(
  'dsconfig set-local-db-index-prop --backend-name userRoot --index-name cn --add index-type:substring',
  "dsconfig set-password-policy-prop --policy-name 'Default Password Policy' --set min-password-length:12",
);

function setup(current: string, currentUri = 'file:///policies.dsconfig') {
  const { document, position } = withCursor(current);
  const index = indexOf({ 'file:///backends.dsconfig': BACKENDS, [currentUri]: document });
  return { document, position, index };
}

describe('definitions and references', () => {
  it('jumps from a reference to the create command in another file', () => {
    const { document, position, index } = setup(
      'dsconfig set-backend-prop --backend-name user|Root --set enabled:true',
    );
    expect(findDefinition(document, position, index)).toEqual([
      {
        uri: 'file:///backends.dsconfig',
        range: { start: { line: 2, character: 19 }, end: { line: 2, character: 27 } },
      },
    ]);
  });

  it('resolves parent naming arguments to the parent object', () => {
    const { document, position, index } = setup(
      'dsconfig set-local-db-index-prop --backend-name user|Root --index-name cn',
    );
    expect(findDefinition(document, position, index)[0].range.start.line).toBe(2);
  });

  it('finds child objects by their own naming argument', () => {
    const { document, position, index } = setup(
      'dsconfig set-local-db-index-prop --backend-name userRoot --index-name c|n',
    );
    const [definition] = findDefinition(document, position, index);
    expect(definition.uri).toBe('file:///backends.dsconfig');
    expect(definition.range.start.line).toBe(4);
  });

  it('matches names case-insensitively and lists every reference', () => {
    const { document, position, index } = setup('dsconfig get-backend-prop --backend-name USER|ROOT');
    const references = findReferences(document, position, index, true);
    expect(references.map((location) => `${location.uri}:${location.range.start.line}`)).toEqual([
      'file:///backends.dsconfig:2',
      'file:///backends.dsconfig:4',
      'file:///policies.dsconfig:0',
    ]);
    expect(findReferences(document, position, index, false)).toHaveLength(2);
  });

  it('highlights occurrences in the current document', () => {
    const { document, position, index } = setup(
      BACKENDS.replace('--backend-name userRoot \\', '--backend-name user|Root \\'),
      'file:///backends.dsconfig',
    );
    expect(
      documentHighlights(document, 'file:///backends.dsconfig', position, index).map(
        (highlight) => highlight.kind,
      ),
    ).toEqual([DocumentHighlightKind.Write, DocumentHighlightKind.Read]);
  });

  it('returns nothing outside naming arguments', () => {
    const { document, position, index } = setup(
      'dsconfig set-backend-prop --backend-name userRoot --set ena|bled:true',
    );
    expect(findDefinition(document, position, index)).toEqual([]);
    expect(prepareRename(document, position, index)).toBeNull();
  });
});

describe('rename', () => {
  it('renames every reference across files, quoting when needed', () => {
    const { document, position, index } = setup('dsconfig set-backend-prop --backend-name user|Root');
    expect(prepareRename(document, position, index)?.placeholder).toBe('userRoot');
    const edit = rename(document, position, 'main data', index)!;
    expect(Object.keys(edit.changes!).sort()).toEqual([
      'file:///backends.dsconfig',
      'file:///policies.dsconfig',
    ]);
    expect(edit.changes!['file:///backends.dsconfig'].map((change) => change.newText)).toEqual([
      '"main data"',
      '"main data"',
    ]);
  });

  it('keeps the existing quote style', () => {
    expect(quoteName('New Policy', "'Default Password Policy'")).toBe("'New Policy'");
    expect(quoteName('plain', '"quoted"')).toBe('"plain"');
    expect(quoteName('plain', 'bare')).toBe('plain');
    expect(quoteName('say "hi"', 'bare')).toBe('"say \\"hi\\""');
    expect(quoteName('-root', 'bare')).toBe('"-root"');
  });
});

describe('hover', () => {
  const hoverText = (text: string): string => {
    const { document, position, index } = setup(text);
    const hover = computeHover(document, position, new Catalog(), index);
    expect(hover?.contents).toMatchObject({ kind: MarkupKind.Markdown });
    return (hover!.contents as MarkupContent).value;
  };

  it('describes subcommands and related commands', () => {
    const text = hoverText('dsconfig set-back|end-prop --backend-name userRoot');
    expect(text).toContain('Modifies Backend properties.');
    expect(text).toContain('`create-backend`');
  });

  it('suggests fixes for unknown subcommands', () => {
    expect(hoverText('dsconfig crate-back|end')).toContain('`create-backend`');
  });

  it('documents options and properties', () => {
    expect(hoverText('dsconfig create-backend --ty|pe local-db')).toContain('**--type, -t** `{type}`');
    expect(
      hoverText(
        'dsconfig set-local-db-index-prop --backend-name userRoot --index-name cn --add index-ty|pe:x',
      ),
    ).toContain('`equality` (1)');
  });

  it('shows where a named object is created', () => {
    const text = hoverText('dsconfig set-backend-prop --backend-name user|Root');
    expect(text).toContain('**Backend** `userRoot`');
    expect(text).toContain('[backends.dsconfig:3](file:///backends.dsconfig#L3)');
  });

  it('explains objects that are not created in the workspace', () => {
    expect(hoverText('dsconfig set-backend-prop --backend-name change|log')).toContain(
      'built in to the server',
    );
  });
});

describe('symbols and folding', () => {
  const document = new ParsedDocument(BACKENDS);

  it('nests commands under region comments', () => {
    const [region] = documentSymbols(document);
    expect(region).toMatchObject({ name: 'Backends', kind: SymbolKind.Namespace });
    expect(region.range.end.line).toBe(5);
    expect(region.children!.map((symbol) => [symbol.name, symbol.kind])).toEqual([
      ['create-backend userRoot', SymbolKind.Constructor],
      ['create-local-db-index userRoot / cn', SymbolKind.Constructor],
    ]);
    expect(region.children![0].children!.map((child) => child.name)).toEqual([
      '--backend-name userRoot',
      '--type local-db',
    ]);
  });

  it('searches commands across the workspace', () => {
    const index = indexOf({ 'file:///backends.dsconfig': BACKENDS, 'file:///policies.dsconfig': POLICIES });
    expect(workspaceSymbols(index, 'pwpolicy').map((symbol) => symbol.name)).toEqual([
      'set-password-policy-prop Default Password Policy',
    ]);
    expect(workspaceSymbols(index, 'userRoot')).toHaveLength(3);
  });

  it('folds multi-line commands, comment blocks, and regions', () => {
    const text = lines(
      '# one',
      '# two',
      'set-x-prop \\',
      '  --set a:b',
      '# region R',
      'list-backends',
      '# endregion',
    );
    expect(foldingRanges(new ParsedDocument(text))).toEqual([
      { startLine: 0, endLine: 1, kind: FoldingRangeKind.Comment },
      { startLine: 2, endLine: 3 },
      { startLine: 4, endLine: 6, kind: FoldingRangeKind.Region },
    ]);
  });
});
