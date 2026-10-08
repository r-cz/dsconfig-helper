import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Catalog } from './server/catalog';
import { computeDiagnostics } from './server/diagnostics';
import { ParsedDocument } from './server/parser';

interface Snippet {
  prefix: string | string[];
  body: string[];
}

const snippets = JSON.parse(
  readFileSync(join(import.meta.dir, '../snippets/dsconfig.code-snippets'), 'utf8'),
) as Record<string, Snippet>;

/** Expands a snippet body the way VS Code would with every default accepted. */
function expand(body: string[]): string {
  return body
    .join('\n')
    .replace(/\$\{\d+\|([^,|]*)[^}]*\|\}/g, '$1')
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\\\$/g, '$');
}

describe('snippets', () => {
  const catalog = new Catalog();
  const commands = Object.entries(snippets).filter(([, snippet]) =>
    catalog.isKnown(snippet.body[0].split(' ')[0]),
  );

  it('includes complete commands to check', () => {
    expect(commands.length).toBeGreaterThan(5);
  });

  for (const [name, snippet] of commands) {
    it(`expands '${name}' to a valid command`, () => {
      const text = expand(snippet.body);
      const diagnostics = computeDiagnostics(new ParsedDocument(text), catalog, {
        enabled: true,
        unknownSubcommands: true,
      });
      expect({ text, messages: diagnostics.map((diagnostic) => diagnostic.message) }).toEqual({
        text,
        messages: [],
      });
    });
  }
});
