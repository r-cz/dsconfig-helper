import { describe, expect, it } from 'bun:test';
import { DiagnosticSeverity, type Diagnostic } from 'vscode-languageserver';
import { Catalog } from './catalog';
import {
  computeDiagnostics,
  DiagnosticCode,
  type DiagnosticData,
  type ValidationSettings,
} from './diagnostics';
import { ParsedDocument } from './parser';
import { lines } from './testing';

const SETTINGS: ValidationSettings = { enabled: true, unknownSubcommands: true };

function diagnose(text: string, catalog = new Catalog(), settings = SETTINGS): Diagnostic[] {
  return computeDiagnostics(new ParsedDocument(text), catalog, settings);
}

function codes(text: string): string[] {
  return diagnose(text).map((diagnostic) => String(diagnostic.code));
}

function applyFix(text: string, diagnostic: Diagnostic, fixIndex = 0): string {
  const document = new ParsedDocument(text);
  const edits = [...(diagnostic.data as DiagnosticData).fixes![fixIndex].edits].sort(
    (a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start),
  );
  let result = text;
  for (const edit of edits) {
    result =
      result.slice(0, document.offsetAt(edit.range.start)) +
      edit.newText +
      result.slice(document.offsetAt(edit.range.end));
  }
  return result;
}

describe('property assignments', () => {
  it('reports a missing assignment separator', () => {
    const text = 'dsconfig set-backend-prop --backend-name userRoot --set db-cache-percent';
    const [diagnostic, ...rest] = diagnose(text);
    expect(rest).toEqual([]);
    expect(diagnostic.code).toBe(DiagnosticCode.malformedAssignment);
    expect(diagnostic.message).toMatch(/Expected property assignment/);
    const start = text.indexOf('db-cache');
    expect(diagnostic.range).toEqual({
      start: { line: 0, character: start },
      end: { line: 0, character: text.length },
    });
  });

  it('accepts name:value and name<file assignments, quoted or not', () => {
    expect(diagnose('set-backend-prop --backend-name userRoot --set db-cache-percent:40')).toEqual([]);
    expect(
      diagnose('set-root-dn-user-prop --user-name admin --set password<${ROOT_USER_PASSWORD_FILE}'),
    ).toEqual([]);
    expect(diagnose('set-backend-prop --backend-name userRoot --set "db-cache-percent:40"')).toEqual([]);
    expect(diagnose('set-backend-prop --backend-name userRoot --set "description:has spaces"')).toEqual([]);
  });

  it('reports a quoted assignment missing its separator', () => {
    expect(codes('set-backend-prop --backend-name userRoot --set "db-cache-percent"')).toEqual([
      DiagnosticCode.malformedAssignment,
    ]);
  });

  it('skips assignments built from substitution variables', () => {
    expect(diagnose('set-backend-prop --backend-name userRoot --set ${CACHE_SETTING}')).toEqual([]);
  });

  it('reports missing values, including at the end of a line', () => {
    const [diagnostic] = diagnose('set-backend-prop --backend-name userRoot --add');
    expect(diagnostic.code).toBe(DiagnosticCode.missingValue);
    expect(diagnostic.message).toBe('Expected property assignment (name:value) after --add.');
    expect(diagnostic.severity).toBe(DiagnosticSeverity.Error);
    expect(codes('set-backend-prop --backend-name --set enabled:true')).toEqual([
      DiagnosticCode.missingValue,
    ]);
  });

  it('reports only the invalid option on a line', () => {
    expect(codes('set-backend-prop --backend-name userRoot --set db-cache-percent:40 --add')).toEqual([
      DiagnosticCode.missingValue,
    ]);
  });

  it('rejects --reset with an assignment and offers to drop the value', () => {
    const text = 'set-backend-prop --backend-name userRoot --reset db-cache-percent:40';
    const [diagnostic] = diagnose(text);
    expect(diagnostic.code).toBe(DiagnosticCode.unexpectedAssignment);
    expect(applyFix(text, diagnostic)).toBe(
      'set-backend-prop --backend-name userRoot --reset db-cache-percent',
    );
    expect(diagnose('set-backend-prop --backend-name userRoot --reset db-cache-percent')).toEqual([]);
  });

  it('flags a property that is both reset and assigned', () => {
    expect(codes('set-backend-prop --backend-name userRoot --reset enabled --set enabled:true')).toEqual([
      DiagnosticCode.conflictingProperty,
    ]);
  });

  it('treats a bare -- as an option still being typed', () => {
    expect(diagnose('set-backend-prop --backend-name userRoot --')).toEqual([]);
  });

  it('flags stray tokens from unquoted values with spaces', () => {
    const [diagnostic] = diagnose('set-backend-prop --backend-name userRoot --set description:two words');
    expect(diagnostic.code).toBe(DiagnosticCode.unexpectedArgument);
    expect(diagnostic.message).toContain('wrap that value in quotes');
  });
});

describe('multi-line commands', () => {
  it('validates assignments across continuation lines without false positives', () => {
    const text = lines(
      'dsconfig set-backend-prop \\',
      '    --backend-name userRoot \\',
      '    --set \\',
      '      db-cache-percent:40',
    );
    expect(diagnose(text)).toEqual([]);
  });

  it('ignores comment lines', () => {
    expect(diagnose('# dsconfig set-backend-prop --set db-cache-percent')).toEqual([]);
  });

  it('reports a dangling continuation and offers to remove it', () => {
    const text = lines('set-backend-prop --backend-name userRoot --set enabled:true \\', '', 'list-backends');
    const [diagnostic] = diagnose(text);
    expect(diagnostic.code).toBe(DiagnosticCode.danglingContinuation);
    expect(applyFix(text, diagnostic)).toBe(
      lines('set-backend-prop --backend-name userRoot --set enabled:true', '', 'list-backends'),
    );
  });

  it('detects a forgotten continuation and offers to add it', () => {
    const text = lines('set-backend-prop \\', '    --backend-name userRoot', '    --set enabled:true');
    const [diagnostic, ...rest] = diagnose(text);
    expect(rest).toEqual([]);
    expect(diagnostic.code).toBe(DiagnosticCode.missingContinuation);
    expect(diagnostic.range.start.line).toBe(2);
    const fixed = applyFix(text, diagnostic);
    expect(fixed).toBe(
      lines('set-backend-prop \\', '    --backend-name userRoot \\', '    --set enabled:true'),
    );
    expect(diagnose(fixed)).toEqual([]);
  });

  it('accepts commented-out argument lines and survives a lone backslash', () => {
    const text = lines(
      'dsconfig create-backend \\',
      '    --backend-name userRoot \\',
      '#    --set db-cache-percent:30 \\',
      '    --type local-db',
    );
    expect(diagnose(text)).toEqual([]);
    expect(codes(lines('list-backends', '\\'))).toEqual([DiagnosticCode.danglingContinuation]);
    expect(codes('\\')).toEqual([DiagnosticCode.danglingContinuation]);
  });

  it('reports an option line with no subcommand after a blank line', () => {
    expect(codes(lines('list-backends', '', '--set enabled:true'))).toEqual([
      DiagnosticCode.missingSubcommand,
    ]);
    expect(codes('dsconfig')).toEqual([DiagnosticCode.missingSubcommand]);
  });

  it('reports unterminated quotes and offers to close them', () => {
    const text = 'set-backend-prop --backend-name "userRoot';
    const [diagnostic] = diagnose(text);
    expect(diagnostic.code).toBe(DiagnosticCode.unterminatedQuote);
    expect(diagnostic.severity).toBe(DiagnosticSeverity.Error);
    expect(applyFix(text, diagnostic)).toBe('set-backend-prop --backend-name "userRoot"');
  });
});

describe('subcommands', () => {
  it('suggests a fix for a misspelled subcommand', () => {
    const text = 'dsconfig crate-backend --backend-name x --type local-db';
    const [diagnostic] = diagnose(text);
    expect(diagnostic.code).toBe(DiagnosticCode.unknownSubcommand);
    expect(diagnostic.severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostic.message).toBe("Unknown subcommand 'crate-backend'. Did you mean 'create-backend'?");
    expect(applyFix(text, diagnostic)).toBe('dsconfig create-backend --backend-name x --type local-db');
  });

  it('reports unrecognized but well-formed subcommands as information', () => {
    const [diagnostic] = diagnose('set-policy-decision-service-prop --set pdp-mode:embedded');
    expect(diagnostic.severity).toBe(DiagnosticSeverity.Information);
    expect(diagnostic.message).toContain('dsconfig.additionalSubcommands');
  });

  it('accepts subcommands from settings and can skip the check entirely', () => {
    const text = 'set-policy-decision-service-prop --set pdp-mode:embedded';
    expect(diagnose(text, new Catalog(['set-policy-decision-service-prop']))).toEqual([]);
    expect(diagnose(text, new Catalog(), { enabled: true, unknownSubcommands: false })).toEqual([]);
  });

  it('reports nothing when validation is disabled', () => {
    expect(
      diagnose('crate-backend --set', new Catalog(), { enabled: false, unknownSubcommands: true }),
    ).toEqual([]);
  });
});

describe('options', () => {
  it('flags options that do not apply to the verb', () => {
    const text = 'create-backend --backend-name x --type local-db --add base-dn:dc=example,dc=com';
    const [diagnostic] = diagnose(text);
    expect(diagnostic.code).toBe(DiagnosticCode.invalidOption);
    expect(diagnostic.message).toBe("'--add' can't be used with create-* subcommands.");
    expect(applyFix(text, diagnostic)).toBe(
      'create-backend --backend-name x --type local-db --set base-dn:dc=example,dc=com',
    );
    expect(codes('get-backend-prop --backend-name x --set enabled:true')).toEqual([
      DiagnosticCode.invalidOption,
    ]);
    expect(codes('delete-backend --backend-name x --reset enabled')).toEqual([DiagnosticCode.invalidOption]);
  });

  it('allows list-properties options', () => {
    expect(diagnose('dsconfig list-properties --category backend --type local-db')).toEqual([]);
  });

  it('does not check option/verb pairs for custom subcommands', () => {
    expect(diagnose('create-sync-pipe --pipe-name p --add x:y', new Catalog(['create-sync-pipe']))).toEqual(
      [],
    );
  });

  it('flags duplicate naming arguments and --type', () => {
    expect(codes('set-backend-prop --backend-name a --backend-name b --set enabled:true')).toEqual([
      DiagnosticCode.duplicateOption,
    ]);
    expect(codes('create-backend --backend-name a --type local-db --type ldif')).toEqual([
      DiagnosticCode.duplicateOption,
    ]);
    expect(diagnose('set-backend-prop --backend-name a --set base-dn:dc=a --set base-dn:dc=b')).toEqual([]);
  });

  it('requires parent naming arguments where they are known', () => {
    const [diagnostic] = diagnose('set-local-db-index-prop --index-name cn --set index-type:equality');
    expect(diagnostic.code).toBe(DiagnosticCode.missingNamingArgument);
    expect(diagnostic.message).toBe('set-local-db-index-prop requires --backend-name.');
    expect(diagnose('list-local-db-indexes --backend-name userRoot')).toEqual([]);
    expect(
      diagnose(
        'set-replication-server-prop --provider-name "Multimaster Synchronization" --set replication-port:8989',
      ),
    ).toEqual([]);
  });
});
