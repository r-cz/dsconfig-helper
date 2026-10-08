import type { Position, Range } from 'vscode-languageserver';
import {
  PROPERTY_OPTIONS,
  canonicalOptionName,
  optionTakesValue,
  parseSubcommandName,
  type Verb,
} from './catalog';

export interface Span {
  start: number;
  /** Exclusive. */
  end: number;
}

export interface Token extends Span {
  /** Source text, including quotes. */
  raw: string;
  /** Text with quotes removed and escapes resolved. */
  value: string;
  /** Document offset of each character of `value`. */
  offsets: number[];
  quoted: boolean;
  /** Offset of an opening quote that is never closed. */
  unterminatedQuote?: number;
}

export interface Assignment {
  property: string;
  propertySpan: Span;
  operator?: ':' | '<';
  operatorOffset?: number;
  /** Text after the operator (empty string when the operator is last). */
  value?: string;
  valueSpan?: Span;
}

export interface Argument {
  option?: Token;
  /** Canonical long option name, e.g. `--type` for `-t`. */
  name?: string;
  value?: Token;
  /** Property reference for `--set`, `--add`, `--remove`, `--reset`, and `--property`. */
  assignment?: Assignment;
}

export interface Continuation {
  /** Offset of the backslash. */
  offset: number;
  line: number;
}

export interface Command extends Span {
  startLine: number;
  endLine: number;
  /** Lines holding command text; comment lines inside a continued command are skipped. */
  textLines: number[];
  tokens: Token[];
  /** Leading `dsconfig` keyword, if present. */
  prefix?: Token;
  subcommand?: Token;
  verb?: Verb;
  objectType?: string;
  /** Options that appear before the subcommand. */
  leadingArgs: Argument[];
  args: Argument[];
  continuations: Continuation[];
  /** A trailing backslash not followed by another line of the command. */
  danglingContinuation?: Continuation;
}

export interface Comment extends Span {
  line: number;
  text: string;
}

export interface LineInfo {
  start: number;
  /** End of the line content, excluding the line terminator. */
  end: number;
}

const CONTINUATION = /\\[ \t]*$/;
const PREFIX = /^(?:.*[\\/])?dsconfig(?:\.bat)?$/i;
// A bare `-` or `--` is an option still being typed.
const OPTION = /^--?(?:[A-Za-z]|$)/;
const PROPERTY_NAME = /^[A-Za-z][A-Za-z0-9-]*/;

export class ParsedDocument {
  readonly lines: LineInfo[];
  readonly commands: Command[] = [];
  readonly comments: Comment[] = [];

  constructor(readonly text: string) {
    this.lines = splitLines(text);
    this.parse();
  }

  lineText(line: number): string {
    const info = this.lines[line];
    return info ? this.text.slice(info.start, info.end) : '';
  }

  positionAt(offset: number): Position {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let low = 0;
    let high = this.lines.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lines[mid].start <= clamped) low = mid;
      else high = mid - 1;
    }
    return { line: low, character: clamped - this.lines[low].start };
  }

  offsetAt(position: Position): number {
    if (position.line >= this.lines.length) return this.text.length;
    if (position.line < 0) return 0;
    const line = this.lines[position.line];
    return Math.min(line.start + Math.max(0, position.character), line.end);
  }

  rangeOf(span: Span): Range {
    return { start: this.positionAt(span.start), end: this.positionAt(span.end) };
  }

  commandAtLine(line: number): Command | undefined {
    let low = 0;
    let high = this.commands.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const command = this.commands[mid];
      if (line < command.startLine) high = mid - 1;
      else if (line > command.endLine) low = mid + 1;
      else return command;
    }
    return undefined;
  }

  private isComment(line: number): boolean {
    return this.lineText(line).trimStart().startsWith('#');
  }

  private addComment(line: number): void {
    const text = this.lineText(line);
    const start = this.lines[line].start + text.indexOf('#');
    this.comments.push({ line, start, end: this.lines[line].end, text: text.trim() });
  }

  private parse(): void {
    let line = 0;
    while (line < this.lines.length) {
      if (this.lineText(line).trim() === '') {
        line++;
        continue;
      }
      if (this.isComment(line)) {
        this.addComment(line);
        line++;
        continue;
      }

      const commandLines = [line];
      let last = line;
      let resume = line + 1;
      let dangling: Continuation | undefined;
      while (CONTINUATION.test(this.lineText(last))) {
        // Like dsconfig's batch reader, skip comment lines inside a continued
        // command, so an argument line can be commented out.
        let next = last + 1;
        while (next < this.lines.length && this.isComment(next)) this.addComment(next++);
        if (next >= this.lines.length || this.lineText(next).trim() === '') {
          dangling = { line: last, offset: this.continuationOffset(last) };
          resume = next;
          break;
        }
        last = next;
        commandLines.push(last);
        resume = last + 1;
      }
      this.commands.push(this.buildCommand(commandLines, dangling));
      line = resume;
    }
  }

  private continuationOffset(line: number): number {
    const match = CONTINUATION.exec(this.lineText(line))!;
    return this.lines[line].start + match.index;
  }

  private buildCommand(commandLines: number[], dangling: Continuation | undefined): Command {
    const chars: string[] = [];
    const offsets: number[] = [];
    const continuations: Continuation[] = [];

    commandLines.forEach((line, index) => {
      const info = this.lines[line];
      const isLast = index === commandLines.length - 1;
      let end = info.end;
      if (!isLast || dangling) {
        const offset = this.continuationOffset(line);
        if (!isLast) continuations.push({ line, offset });
        end = offset;
      }
      for (let offset = info.start; offset < end; offset++) {
        chars.push(this.text[offset]);
        offsets.push(offset);
      }
      if (!isLast) {
        // The continuation behaves like whitespace between tokens.
        chars.push(' ');
        offsets.push(end);
      }
    });

    const tokens = tokenize(this.text, chars, offsets);
    const command: Command = {
      start: tokens[0]?.start ?? this.lines[commandLines[0]].start,
      end: tokens[tokens.length - 1]?.end ?? this.lines[commandLines[0]].end,
      startLine: commandLines[0],
      endLine: commandLines[commandLines.length - 1],
      textLines: commandLines,
      tokens,
      leadingArgs: [],
      args: [],
      continuations,
      danglingContinuation: dangling,
    };
    parseStructure(command);
    return command;
  }
}

function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 10 || code === 13) {
      lines.push({ start, end: i });
      if (code === 13 && text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
  }
  lines.push({ start, end: text.length });
  return lines;
}

function tokenize(text: string, chars: string[], offsets: number[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) {
      i++;
      continue;
    }
    const start = offsets[i];
    let value = '';
    const valueOffsets: number[] = [];
    let quoted = false;
    let unterminatedQuote: number | undefined;
    let last = start;

    while (i < chars.length && !/\s/.test(chars[i])) {
      const ch = chars[i];
      if (ch === '"' || ch === "'") {
        quoted = true;
        const openOffset = offsets[i];
        last = offsets[i];
        i++;
        while (i < chars.length && chars[i] !== ch) {
          if (ch === '"' && chars[i] === '\\' && (chars[i + 1] === '"' || chars[i + 1] === '\\')) {
            i++;
          }
          value += chars[i];
          valueOffsets.push(offsets[i]);
          last = offsets[i];
          i++;
        }
        if (i >= chars.length) {
          unterminatedQuote = openOffset;
          break;
        }
        last = offsets[i];
        i++;
      } else {
        value += ch;
        valueOffsets.push(offsets[i]);
        last = offsets[i];
        i++;
      }
    }

    const end = last + 1;
    tokens.push({
      start,
      end,
      raw: text.slice(start, end),
      value,
      offsets: valueOffsets,
      quoted,
      unterminatedQuote,
    });
  }
  return tokens;
}

export function isOptionToken(token: Token): boolean {
  return !token.quoted && OPTION.test(token.value);
}

function parseStructure(command: Command): void {
  const { tokens } = command;
  let i = 0;
  if (tokens[0] && !tokens[0].quoted && PREFIX.test(tokens[0].value)) {
    command.prefix = tokens[0];
    i = 1;
  }

  const readArgument = (): Argument => {
    const option = tokens[i++];
    const name = canonicalOptionName(option.value, command.verb);
    const argument: Argument = { option, name };
    const next = tokens[i];
    if (next && optionTakesValue(name, command.verb) && !isOptionToken(next)) {
      argument.value = next;
      i++;
      if (PROPERTY_OPTIONS.has(name)) argument.assignment = parseAssignment(next);
    }
    return argument;
  };

  while (i < tokens.length && isOptionToken(tokens[i])) {
    command.leadingArgs.push(readArgument());
  }
  if (i < tokens.length) {
    command.subcommand = tokens[i++];
    const parsed = parseSubcommandName(command.subcommand.value);
    command.verb = parsed?.verb;
    command.objectType = parsed?.objectType;
  }
  while (i < tokens.length) {
    if (isOptionToken(tokens[i])) {
      command.args.push(readArgument());
    } else {
      command.args.push({ value: tokens[i++] });
    }
  }
}

function parseAssignment(token: Token): Assignment | undefined {
  const match = PROPERTY_NAME.exec(token.value);
  if (!match) return undefined;
  const length = match[0].length;
  const assignment: Assignment = {
    property: match[0],
    propertySpan: { start: token.offsets[0], end: token.offsets[length - 1] + 1 },
  };
  const operator = token.value[length];
  if (operator === ':' || operator === '<') {
    assignment.operator = operator;
    assignment.operatorOffset = token.offsets[length];
    assignment.value = token.value.slice(length + 1);
    const valueStart = assignment.operatorOffset + 1;
    assignment.valueSpan =
      assignment.value.length > 0
        ? { start: token.offsets[length + 1], end: token.offsets[token.value.length - 1] + 1 }
        : { start: valueStart, end: valueStart };
  }
  return assignment;
}

/** Every argument in the command, before and after the subcommand. */
export function allArguments(command: Command): Argument[] {
  return [...command.leadingArgs, ...command.args];
}

/** Whether a property name occupies the whole value (`--reset name`). */
export function isBarePropertyName(argument: Argument): boolean {
  return (
    argument.assignment !== undefined &&
    argument.assignment.operator === undefined &&
    argument.assignment.property.length === argument.value?.value.length
  );
}
