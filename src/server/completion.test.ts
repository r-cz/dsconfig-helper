import { describe, expect, it } from 'bun:test';
import type { CompletionItem, TextEdit } from 'vscode-languageserver';
import { Catalog } from './catalog';
import { computeCompletions } from './completion';
import { indexOf, lines, withCursor } from './testing';

const WORKSPACE = lines(
  'dsconfig create-backend --backend-name userRoot --type local-db --set base-dn:dc=example,dc=com --set enabled:true',
  'dsconfig set-backend-prop --backend-name userRoot --set db-cache-percent:40',
  'dsconfig set-backend-prop --backend-name userRoot --set db-cache-percent:25',
  'dsconfig set-backend-prop --backend-name userRoot --set db-cache-percent:40',
  'dsconfig set-backend-prop --backend-name userRoot --set "description:Main user data"',
  'dsconfig set-password-policy-prop --policy-name "Default Password Policy" --set min-password-length:12',
  'dsconfig set-root-dn-user-prop --user-name admin --set password<${ROOT_PASSWORD_FILE}',
);

function complete(textWithCursor: string, workspace = WORKSPACE): CompletionItem[] {
  const { document, position } = withCursor(textWithCursor);
  const index = indexOf({ 'file:///workspace.dsconfig': workspace, 'file:///current.dsconfig': document });
  return computeCompletions(document, position, new Catalog(), index);
}

function labels(items: CompletionItem[]): string[] {
  return [...items]
    .sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label))
    .map((item) => item.label);
}

function find(items: CompletionItem[], label: string): CompletionItem {
  const item = items.find((candidate) => candidate.label === label);
  if (!item)
    throw new Error(`No completion '${label}' in ${items.map((candidate) => candidate.label).join(', ')}`);
  return item;
}

const edit = (item: CompletionItem): TextEdit => item.textEdit as TextEdit;

describe('subcommand completion', () => {
  it('offers subcommands and the dsconfig prefix on an empty line', () => {
    const items = complete('|');
    expect(find(items, 'create-backend').detail).toBe('Creates a Backend.');
    expect(find(items, 'dsconfig').textEdit).toBeDefined();
    expect(items.length).toBeGreaterThan(500);
  });

  it('replaces the partial subcommand and ranks workspace subcommands first', () => {
    const items = complete('dsconfig set-ba|');
    const item = find(items, 'set-backend-prop');
    expect(edit(item).range).toEqual({ start: { line: 0, character: 9 }, end: { line: 0, character: 15 } });
    expect(edit(item).newText).toBe('set-backend-prop ');
    expect(item.command?.command).toBe('editor.action.triggerSuggest');
    expect(item.sortText! < find(items, 'set-alarm-manager-prop').sortText!).toBe(true);
    expect(items.some((candidate) => candidate.label === 'dsconfig')).toBe(false);
  });
});

describe('option completion', () => {
  it('offers naming, verb, and global options in that order', () => {
    const items = complete('set-backend-prop --|');
    const ordered = labels(items);
    expect(ordered.slice(0, 5)).toEqual(['--backend-name', '--add', '--remove', '--reset', '--set']);
    expect(ordered).toContain('--no-prompt');
    expect(ordered).not.toContain('--type');
    expect(edit(find(items, '--set')).range.start).toEqual({ line: 0, character: 17 });
    expect(edit(find(items, '--set')).newText).toBe('--set ');
    expect(edit(find(items, '--no-prompt')).newText).toBe('--no-prompt');
  });

  it('includes parent naming arguments and create-only options', () => {
    const ordered = labels(complete('create-local-db-index |'));
    expect(ordered.slice(0, 4)).toEqual(['--backend-name', '--index-name', '--set', '--type']);
    expect(ordered).not.toContain('--add');
  });

  it('omits naming arguments that are already present', () => {
    const ordered = labels(complete('set-backend-prop --backend-name userRoot |'));
    expect(ordered).not.toContain('--backend-name');
    expect(ordered).toContain('--set');
  });

  it('works on continuation lines and after a trailing backslash', () => {
    expect(
      labels(complete(lines('set-backend-prop \\', '    --backend-name userRoot \\', '    --s|'))),
    ).toContain('--set');
    expect(labels(complete(lines('set-backend-prop --backend-name userRoot \\', '    |')))).toContain(
      '--set',
    );
  });

  it('offers nothing inside comments', () => {
    expect(complete('# set-backend-prop --|')).toEqual([]);
  });
});

describe('value completion', () => {
  it('offers properties seen for the object type and appends the separator', () => {
    const items = complete('set-backend-prop --backend-name userRoot --set |');
    expect(labels(items)[0]).toBe('db-cache-percent');
    expect(labels(items)).toContain('base-dn');
    expect(labels(items)).not.toContain('min-password-length');
    const item = find(items, 'db-cache-percent');
    expect(edit(item).newText).toBe('db-cache-percent:');
    expect(item.command?.command).toBe('editor.action.triggerSuggest');
  });

  it('completes bare property names after --reset', () => {
    const item = find(complete('set-backend-prop --backend-name userRoot --reset db|'), 'db-cache-percent');
    expect(edit(item).newText).toBe('db-cache-percent');
    expect(edit(item).range).toEqual({ start: { line: 0, character: 49 }, end: { line: 0, character: 51 } });
  });

  it('offers values seen for a property, most common first', () => {
    const items = complete('set-backend-prop --backend-name userRoot --set db-cache-percent:|');
    expect(labels(items)).toEqual(['40', '25']);
    expect(edit(items[0]).range.start).toEqual({ line: 0, character: 64 });
  });

  it('offers booleans for enabled properties', () => {
    expect(labels(complete('set-backend-prop --backend-name userRoot --set enabled:|'))).toEqual([
      'true',
      'false',
    ]);
  });

  it('quotes values containing spaces', () => {
    const item = find(
      complete('set-backend-prop --backend-name userRoot --set description:M|'),
      'Main user data',
    );
    expect(edit(item).newText).toBe('"description:Main user data"');
    expect(item.filterText).toBe('description:Main user data');
    const quoted = find(
      complete('set-backend-prop --backend-name userRoot --set "description:M|"'),
      'Main user data',
    );
    expect(edit(quoted).newText).toBe('Main user data');
  });

  it('escapes values for the quotes they are inserted into', () => {
    const aci = '(targetattr="*")(version 3.0; acl "Anon"; allow (read) userdn="ldap:///anyone";)';
    const workspace = lines(WORKSPACE, `dsconfig set-access-control-handler-prop --add 'global-aci:${aci}'`);
    const inDouble = complete('set-access-control-handler-prop --add "global-aci:|"', workspace);
    expect(edit(find(inDouble, aci)).newText).toBe(aci.replace(/"/g, '\\"'));
    const inSingle = complete("set-access-control-handler-prop --add 'global-aci:|'", workspace);
    expect(edit(find(inSingle, aci)).newText).toBe(aci);
    const bare = complete('set-access-control-handler-prop --add global-aci:|', workspace);
    expect(edit(find(bare, aci)).newText).toBe(`"global-aci:${aci.replace(/"/g, '\\"')}"`);
  });

  it('keeps the closing quote when completing inside empty quotes', () => {
    const item = find(complete('set-backend-prop --backend-name userRoot --set "|"'), 'db-cache-percent');
    const offset = 'set-backend-prop --backend-name userRoot --set "'.length;
    expect(edit(item).range).toEqual({
      start: { line: 0, character: offset },
      end: { line: 0, character: offset },
    });
  });

  it('offers no property values after the < file operator', () => {
    expect(complete('set-backend-prop --backend-name userRoot --set base-dn<|')).toEqual([]);
  });

  it('offers object names for naming arguments', () => {
    const items = complete('set-backend-prop --backend-name |');
    expect(labels(items)).toEqual(['userRoot']);
    expect(find(items, 'userRoot').detail).toBe('Backend');
  });

  it('quotes object names that contain spaces', () => {
    const item = find(complete('get-password-policy-prop --policy-name D|'), 'Default Password Policy');
    expect(edit(item).newText).toBe('"Default Password Policy"');
  });

  it('offers --type values seen for the object type', () => {
    expect(labels(complete('create-backend --backend-name other --type |'))).toEqual(['local-db']);
  });

  it('offers substitution variables inside ${', () => {
    const text = 'set-root-dn-user-prop --user-name admin --set password<${RO|';
    const item = find(complete(text), '${ROOT_PASSWORD_FILE}');
    expect(edit(item).range.start.character).toBe(text.indexOf('${'));
    expect(edit(item).newText).toBe('${ROOT_PASSWORD_FILE}');
  });

  it('offers fixed values for global options', () => {
    expect(labels(complete('dsconfig --applyChangeTo |'))).toEqual(['single-server', 'server-group']);
  });
});
