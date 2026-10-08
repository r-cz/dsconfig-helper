import type { Range, TextEdit } from 'vscode-languageserver';
import type { Command, ParsedDocument, Token } from './parser';

export type Layout = 'preserve' | 'multiline' | 'singleline';

export interface FormatSettings {
  layout: Layout;
  indentSize: number;
  dsconfigPrefix: 'preserve' | 'add' | 'remove';
}

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  layout: 'preserve',
  indentSize: 4,
  dsconfigPrefix: 'preserve',
};

function eol(document: ParsedDocument): string {
  return document.text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Whether the formatter can safely rewrite this command. Commands with a dangling
 * continuation, commented-out lines, or a stray `#` word (which would become a
 * comment at the start of a line) are left for the user to fix.
 */
export function isFormattable(document: ParsedDocument, command: Command): boolean {
  if (!command.subcommand || command.danglingContinuation) return false;
  if (command.textLines.length !== command.endLine - command.startLine + 1) return false;
  return command.tokens.every(
    (token) =>
      token.unterminatedQuote === undefined &&
      !token.raw.startsWith('#') &&
      document.positionAt(token.start).line === document.positionAt(token.end - 1).line,
  );
}

function blockRange(document: ParsedDocument, command: Command): Range {
  const last = document.lines[command.endLine];
  return {
    start: { line: command.startLine, character: 0 },
    end: { line: command.endLine, character: last.end - last.start },
  };
}

/** Lays out a single command. Returns undefined when it can't be formatted safely. */
export function formatCommand(
  document: ParsedDocument,
  command: Command,
  settings: FormatSettings,
  layout: Layout = settings.layout,
): string | undefined {
  if (!isFormattable(document, command)) return undefined;
  const indent = ' '.repeat(settings.indentSize);
  const newline = ` \\${eol(document)}`;

  const prefix =
    settings.dsconfigPrefix === 'remove'
      ? undefined
      : (command.prefix?.raw ?? (settings.dsconfigPrefix === 'add' ? 'dsconfig' : undefined));
  const drop = new Set<Token>(command.prefix && prefix === undefined ? [command.prefix] : []);

  if (layout === 'preserve') {
    const lines = new Map<number, string[]>();
    for (const token of command.tokens) {
      if (drop.has(token)) continue;
      const line = document.positionAt(token.start).line;
      const words = lines.get(line) ?? [];
      words.push(token.raw);
      lines.set(line, words);
    }
    const rows = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, words]) => words.join(' '));
    if (prefix && !command.prefix) rows[0] = `${prefix} ${rows[0]}`;
    return rows.map((row, i) => (i === 0 ? row : indent + row)).join(newline);
  }

  const unit = (option?: Token, value?: Token): string => [option?.raw, value?.raw].filter(Boolean).join(' ');
  const head = [
    prefix,
    ...command.leadingArgs.map((argument) => unit(argument.option, argument.value)),
    command.subcommand!.raw,
  ]
    .filter(Boolean)
    .join(' ');
  const units = command.args.map((argument) => unit(argument.option, argument.value));

  if (layout === 'singleline' || units.length === 0) return [head, ...units].join(' ');
  return [head, ...units.map((text) => indent + text)].join(newline);
}

export function formatDocument(
  document: ParsedDocument,
  settings: FormatSettings,
  range?: Range,
): TextEdit[] {
  const edits: TextEdit[] = [];
  const inRange = (start: number, end: number): boolean =>
    !range || (end >= range.start.line && start <= range.end.line);
  const covered = new Set<number>();

  for (const command of document.commands) {
    for (let line = command.startLine; line <= command.endLine; line++) covered.add(line);
    if (!inRange(command.startLine, command.endLine)) continue;
    const block = blockRange(document, command);
    const original = document.text.slice(document.offsetAt(block.start), document.offsetAt(block.end));
    // Commands that can't be formatted safely (e.g. an unclosed quote) are left untouched.
    const formatted = formatCommand(document, command, settings);
    if (formatted !== undefined && formatted !== original) {
      edits.push({ range: block, newText: formatted });
    }
  }

  for (let line = 0; line < document.lines.length; line++) {
    if (covered.has(line) || !inRange(line, line)) continue;
    edits.push(...trimTrailingWhitespace(document, line, line));
  }
  return edits;
}

function trimTrailingWhitespace(document: ParsedDocument, from: number, to: number): TextEdit[] {
  const edits: TextEdit[] = [];
  for (let line = from; line <= to; line++) {
    const text = document.lineText(line);
    const trimmed = text.trimEnd();
    if (trimmed.length !== text.length) {
      edits.push({
        range: { start: { line, character: trimmed.length }, end: { line, character: text.length } },
        newText: '',
      });
    }
  }
  return edits;
}
