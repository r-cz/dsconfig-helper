import { beforeAll, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OnigScanner, OnigString, loadWASM } from 'vscode-oniguruma';
import { INITIAL, Registry, parseRawGrammar, type IGrammar, type StateStack } from 'vscode-textmate';

const GRAMMAR_PATH = join(import.meta.dir, '../syntaxes/dsconfig.tmLanguage.json');
let grammar: IGrammar;

beforeAll(async () => {
  const wasm = await readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
      createOnigString: (text: string) => new OnigString(text),
    }),
    loadGrammar: async (scopeName) =>
      scopeName === 'source.dsconfig'
        ? parseRawGrammar(await readFile(GRAMMAR_PATH, 'utf8'), GRAMMAR_PATH)
        : null,
  });
  grammar = (await registry.loadGrammar('source.dsconfig'))!;
});

/** Tokenizes lines and returns `text → innermost scope` pairs for the last line. */
function tokens(...lines: string[]): [string, string][] {
  let state: StateStack = INITIAL;
  let result: [string, string][] = [];
  for (const line of lines) {
    const tokenized = grammar.tokenizeLine(line, state);
    state = tokenized.ruleStack;
    result = tokenized.tokens.map((token) => [
      line.slice(token.startIndex, token.endIndex),
      token.scopes[token.scopes.length - 1],
    ]);
  }
  return result.filter(([text]) => text.trim() !== '');
}

function scopeOf(line: string, text: string): string | undefined {
  return tokens(line).find(([candidate]) => candidate === text)?.[1];
}

describe('dsconfig grammar', () => {
  it('highlights a typical command', () => {
    expect(tokens('dsconfig set-backend-prop --backend-name userRoot --set db-cache-percent:40')).toEqual([
      ['dsconfig', 'support.function.dsconfig'],
      ['set-backend-prop', 'keyword.control.dsconfig'],
      ['--backend-name', 'variable.parameter.dsconfig'],
      ['userRoot', 'string.unquoted.name.dsconfig'],
      ['--set', 'variable.parameter.dsconfig'],
      ['db-cache-percent', 'variable.other.property.dsconfig'],
      [':', 'punctuation.separator.key-value.dsconfig'],
      ['40', 'constant.numeric.dsconfig'],
    ]);
  });

  it('only scopes the property name inside quoted assignments', () => {
    const line = '--set "description:see http:x" --add "password<${FILE}"';
    expect(scopeOf(line, 'description')).toBe('variable.other.property.dsconfig');
    expect(scopeOf(line, 'see http:x')).toBe('string.quoted.double.dsconfig');
    expect(scopeOf(line, 'password')).toBe('variable.other.property.dsconfig');
    expect(scopeOf(line, '<')).toBe('punctuation.separator.key-value.dsconfig');
    expect(scopeOf(line, '${FILE}')).toBe('variable.other.environment.dsconfig');
  });

  it('does not treat subcommand-like words inside values as keywords', () => {
    expect(scopeOf('--set description:dsconfig-set-backend-prop', 'dsconfig-set-backend-prop')).toBe(
      'string.unquoted.dsconfig',
    );
    expect(scopeOf('--set "description:run dsconfig set-x-prop"', 'run dsconfig set-x-prop')).toBe(
      'string.quoted.double.dsconfig',
    );
    expect(scopeOf('--set base-dn:cn=a--b', 'cn=a--b')).toBe('string.unquoted.dsconfig');
  });

  it('highlights quoted naming arguments, types, and property names', () => {
    const line =
      "create-password-policy --policy-name 'Strict Policy' --type generic --reset max-password-age";
    expect(scopeOf(line, "'")).toBe('punctuation.definition.string.begin.dsconfig');
    expect(tokens(line)).toContainEqual(['Strict Policy', 'string.quoted.single.dsconfig']);
    expect(scopeOf(line, 'generic')).toBe('entity.name.type.dsconfig');
    expect(scopeOf(line, 'max-password-age')).toBe('variable.other.property.dsconfig');
  });

  it('highlights comments and line continuations', () => {
    expect(tokens('  # a comment --set x:y')).toEqual([
      ['#', 'punctuation.definition.comment.dsconfig'],
      [' a comment --set x:y', 'comment.line.number-sign.dsconfig'],
    ]);
    expect(scopeOf('create-backend \\', '\\')).toBe('punctuation.separator.continuation.dsconfig');
    expect(scopeOf('    --set enabled:true', 'true')).toBe('constant.language.boolean.dsconfig');
  });

  it('keeps an unterminated quote from bleeding into the next line', () => {
    expect(tokens('--set "description:oops', 'list-backends')).toEqual([
      ['list-backends', 'keyword.control.dsconfig'],
    ]);
  });
});
