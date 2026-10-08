import { describe, expect, it } from 'bun:test';
import { ParsedDocument } from './parser';
import { lines } from './testing';

describe('ParsedDocument', () => {
  it('parses a single-line command into prefix, subcommand, and arguments', () => {
    const document = new ParsedDocument(
      'dsconfig set-backend-prop --backend-name userRoot --set db-cache-percent:40',
    );
    const [command] = document.commands;

    expect(command.prefix?.value).toBe('dsconfig');
    expect(command.subcommand?.value).toBe('set-backend-prop');
    expect(command.verb).toBe('set');
    expect(command.objectType).toBe('backend');
    expect(command.args.map((argument) => [argument.name, argument.value?.value])).toEqual([
      ['--backend-name', 'userRoot'],
      ['--set', 'db-cache-percent:40'],
    ]);
    expect(command.args[1].assignment).toMatchObject({
      property: 'db-cache-percent',
      operator: ':',
      value: '40',
    });
  });

  it('joins continuation lines into one command', () => {
    const document = new ParsedDocument(
      lines(
        'dsconfig create-backend \\',
        '    --backend-name userRoot \\',
        '    --type local-db',
        'list-backends',
      ),
    );

    expect(document.commands).toHaveLength(2);
    const [create, list] = document.commands;
    expect(create.startLine).toBe(0);
    expect(create.endLine).toBe(2);
    expect(create.continuations.map((continuation) => continuation.line)).toEqual([0, 1]);
    expect(create.args.map((argument) => argument.name)).toEqual(['--backend-name', '--type']);
    expect(list.subcommand?.value).toBe('list-backends');
    expect(list.verb).toBe('list');
    expect(list.objectType).toBe('backend');
  });

  it('pairs an option with a value on the next continuation line', () => {
    const document = new ParsedDocument(
      lines('set-backend-prop --backend-name userRoot --set \\', '  db-cache-percent:40'),
    );
    const set = document.commands[0].args[1];

    expect(set.value?.value).toBe('db-cache-percent:40');
    expect(set.assignment?.property).toBe('db-cache-percent');
    expect(document.positionAt(set.value!.start)).toEqual({ line: 1, character: 2 });
  });

  it('strips quotes and maps property spans inside quoted values', () => {
    const text = 'set-password-policy-prop --policy-name "Default Password Policy" --set "description:a b"';
    const document = new ParsedDocument(text);
    const [name, set] = document.commands[0].args;

    expect(name.value?.value).toBe('Default Password Policy');
    expect(name.value?.raw).toBe('"Default Password Policy"');
    expect(set.assignment?.value).toBe('a b');
    expect(text.slice(set.assignment!.propertySpan.start, set.assignment!.propertySpan.end)).toBe(
      'description',
    );
    expect(text.slice(set.assignment!.valueSpan!.start, set.assignment!.valueSpan!.end)).toBe('a b');
  });

  it('handles escaped double quotes and single-quoted strings', () => {
    const document = new ParsedDocument(`set-x-prop --set "description:say \\"hi\\"" --set 'motd:it''s'`);
    const [first, second] = document.commands[0].args;

    expect(first.assignment?.value).toBe('say "hi"');
    expect(second.value?.value).toBe('motd:its');
  });

  it('accepts the < operator for reading values from files', () => {
    const document = new ParsedDocument(
      'set-root-dn-user-prop --user-name admin --set password<${PASSWORD_FILE}',
    );
    expect(document.commands[0].args[1].assignment).toMatchObject({
      property: 'password',
      operator: '<',
      value: '${PASSWORD_FILE}',
    });
  });

  it('records comments and skips blank lines', () => {
    const document = new ParsedDocument(lines('# header', '', '  # indented', 'list-backends'));

    expect(document.comments.map((comment) => comment.line)).toEqual([0, 2]);
    expect(document.commands).toHaveLength(1);
    expect(document.commands[0].startLine).toBe(3);
  });

  it('flags a continuation followed by a blank line or the end of the file as dangling', () => {
    const document = new ParsedDocument(
      lines('set-backend-prop --backend-name userRoot \\', '', 'list-backends \\'),
    );

    expect(document.commands).toHaveLength(2);
    expect(document.commands[0].danglingContinuation?.line).toBe(0);
    expect(document.commands[0].args).toHaveLength(1);
    expect(document.commands[1].danglingContinuation?.line).toBe(2);
  });

  it('skips commented-out lines inside a continued command', () => {
    const document = new ParsedDocument(
      lines(
        'dsconfig create-backend \\',
        '    --backend-name userRoot \\',
        '#    --set db-cache-percent:30 \\',
        '    --set enabled:true',
      ),
    );
    const [command] = document.commands;

    expect(document.commands).toHaveLength(1);
    expect(command.endLine).toBe(3);
    expect(command.textLines).toEqual([0, 1, 3]);
    expect(command.args.map((argument) => argument.value?.value)).toEqual(['userRoot', 'enabled:true']);
    expect(document.comments.map((comment) => comment.line)).toEqual([2]);
  });

  it('keeps a line holding only a backslash as an empty command', () => {
    const document = new ParsedDocument(lines('list-backends', '\\', ''));
    expect(document.commands[1]).toMatchObject({ tokens: [], danglingContinuation: { line: 1 } });
  });

  it('reports unterminated quotes', () => {
    const document = new ParsedDocument('set-backend-prop --backend-name "userRoot --set enabled:true');
    const token = document.commands[0].tokens[2];

    expect(token.unterminatedQuote).toBe(document.text.indexOf('"'));
  });

  it('resolves short option aliases and leading global options', () => {
    const document = new ParsedDocument('dsconfig --no-prompt create-backend -t local-db --backend-name x');
    const [command] = document.commands;

    expect(command.leadingArgs.map((argument) => argument.name)).toEqual(['--no-prompt']);
    expect(command.subcommand?.value).toBe('create-backend');
    expect(command.args[0]).toMatchObject({ name: '--type', value: { value: 'local-db' } });
  });

  it('does not treat a following option as a missing value', () => {
    const document = new ParsedDocument('set-backend-prop --backend-name --set enabled:true');
    const [name, set] = document.commands[0].args;

    expect(name.value).toBeUndefined();
    expect(set.name).toBe('--set');
  });

  it('handles CRLF line endings', () => {
    const document = new ParsedDocument(
      'set-backend-prop \\\r\n  --backend-name userRoot\r\nlist-backends\r\n',
    );

    expect(document.commands).toHaveLength(2);
    expect(document.commands[0].args[0].value?.value).toBe('userRoot');
    expect(document.positionAt(document.text.indexOf('list'))).toEqual({ line: 2, character: 0 });
  });

  it('converts between offsets and positions', () => {
    const document = new ParsedDocument(lines('ab', 'cde', ''));

    expect(document.positionAt(4)).toEqual({ line: 1, character: 1 });
    expect(document.offsetAt({ line: 1, character: 1 })).toBe(4);
    expect(document.offsetAt({ line: 1, character: 99 })).toBe(6);
    expect(document.offsetAt({ line: 9, character: 0 })).toBe(document.text.length);
  });

  it('finds the command at a line', () => {
    const document = new ParsedDocument(lines('# c', 'set-x-prop \\', '  --set a:b', '', 'list-backends'));

    expect(document.commandAtLine(0)).toBeUndefined();
    expect(document.commandAtLine(2)?.subcommand?.value).toBe('set-x-prop');
    expect(document.commandAtLine(3)).toBeUndefined();
    expect(document.commandAtLine(4)?.subcommand?.value).toBe('list-backends');
  });
});
