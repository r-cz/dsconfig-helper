import {
  FoldingRangeKind,
  SymbolKind,
  type DocumentSymbol,
  type FoldingRange,
  type Range,
  type SymbolInformation,
} from 'vscode-languageserver';
import { objectTypeLabel, type Verb } from './catalog';
import { uriBasename } from './links';
import { commandLabel } from './model';
import type { Command, ParsedDocument } from './parser';
import type { WorkspaceIndex } from './workspace';

const REGION_START = /^#\s*region\b\s*(.*)$/i;
const REGION_END = /^#\s*endregion\b/i;

const VERB_KINDS: Record<Verb, SymbolKind> = {
  create: SymbolKind.Constructor,
  set: SymbolKind.Property,
  get: SymbolKind.Field,
  list: SymbolKind.Array,
  delete: SymbolKind.Null,
};

function commandKind(command: Command): SymbolKind {
  return command.verb ? VERB_KINDS[command.verb] : SymbolKind.Function;
}

function commandRange(document: ParsedDocument, command: Command): Range {
  return {
    start: { line: command.startLine, character: 0 },
    end: {
      line: command.endLine,
      character: document.lines[command.endLine].end - document.lines[command.endLine].start,
    },
  };
}

function commandSymbol(document: ParsedDocument, command: Command): DocumentSymbol {
  const children: DocumentSymbol[] = command.args
    .filter((argument) => argument.option)
    .map((argument) => {
      const end = argument.value?.end ?? argument.option!.end;
      const range = document.rangeOf({ start: argument.option!.start, end });
      return {
        name: argument.value ? `${argument.name} ${argument.value.value}` : argument.name!,
        kind: argument.assignment ? SymbolKind.Key : SymbolKind.Variable,
        range,
        selectionRange: range,
      };
    });
  return {
    name: commandLabel(command),
    detail: command.objectType ? objectTypeLabel(command.objectType) : undefined,
    kind: commandKind(command),
    range: commandRange(document, command),
    selectionRange: document.rangeOf(command.subcommand!),
    children,
  };
}

/** Outline symbols, nested under `# region` comments. */
export function documentSymbols(document: ParsedDocument): DocumentSymbol[] {
  type Item =
    | { line: number; kind: 'command'; command: Command }
    | { line: number; kind: 'start' | 'end'; name: string };
  const items: Item[] = [
    ...document.commands
      .filter((command) => command.subcommand)
      .map((command) => ({ line: command.startLine, kind: 'command' as const, command })),
    ...document.comments.flatMap((comment): Item[] => {
      const start = REGION_START.exec(comment.text);
      if (start) return [{ line: comment.line, kind: 'start', name: start[1].trim() || 'region' }];
      return REGION_END.test(comment.text) ? [{ line: comment.line, kind: 'end', name: '' }] : [];
    }),
  ].sort((a, b) => a.line - b.line);

  const root: DocumentSymbol[] = [];
  const stack: DocumentSymbol[] = [];
  const container = (): DocumentSymbol[] => (stack.length ? stack[stack.length - 1].children! : root);
  let lastLine = 0;

  for (const item of items) {
    if (item.kind === 'command') {
      container().push(commandSymbol(document, item.command));
      lastLine = item.command.endLine;
    } else if (item.kind === 'start') {
      const range = document.rangeOf({
        start: document.lines[item.line].start,
        end: document.lines[item.line].end,
      });
      const region: DocumentSymbol = {
        name: item.name,
        kind: SymbolKind.Namespace,
        range,
        selectionRange: range,
        children: [],
      };
      container().push(region);
      stack.push(region);
      lastLine = item.line;
    } else if (stack.length) {
      const region = stack.pop()!;
      region.range = {
        start: region.range.start,
        end: { line: item.line, character: document.lines[item.line].end - document.lines[item.line].start },
      };
      lastLine = item.line;
    }
  }
  // Unclosed regions extend to the last item they contain.
  for (const region of stack) {
    region.range = {
      start: region.range.start,
      end: { line: lastLine, character: document.lines[lastLine].end - document.lines[lastLine].start },
    };
  }
  return root;
}

export function workspaceSymbols(index: WorkspaceIndex, query: string, limit = 500): SymbolInformation[] {
  const results: SymbolInformation[] = [];
  const needle = query.toLowerCase().replace(/\s+/g, '');
  for (const [uri, document] of index.documents()) {
    for (const command of document.commands) {
      if (!command.subcommand) continue;
      const name = commandLabel(command);
      if (!fuzzyMatch(needle, name.toLowerCase())) continue;
      results.push({
        name,
        kind: commandKind(command),
        location: { uri, range: commandRange(document, command) },
        containerName: uriBasename(uri),
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

function fuzzyMatch(needle: string, haystack: string): boolean {
  let position = 0;
  for (const ch of needle) {
    position = haystack.indexOf(ch, position);
    if (position < 0) return false;
    position++;
  }
  return true;
}

export function foldingRanges(document: ParsedDocument): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  for (const command of document.commands) {
    if (command.endLine > command.startLine)
      ranges.push({ startLine: command.startLine, endLine: command.endLine });
  }

  const regions: number[] = [];
  let blockStart = -1;
  let blockEnd = -1;
  const flushBlock = (): void => {
    if (blockStart >= 0 && blockEnd > blockStart) {
      ranges.push({ startLine: blockStart, endLine: blockEnd, kind: FoldingRangeKind.Comment });
    }
    blockStart = -1;
  };

  for (const comment of document.comments) {
    if (REGION_START.test(comment.text)) {
      flushBlock();
      regions.push(comment.line);
      continue;
    }
    if (REGION_END.test(comment.text)) {
      flushBlock();
      const start = regions.pop();
      if (start !== undefined)
        ranges.push({ startLine: start, endLine: comment.line, kind: FoldingRangeKind.Region });
      continue;
    }
    if (blockStart >= 0 && comment.line === blockEnd + 1) {
      blockEnd = comment.line;
    } else {
      flushBlock();
      blockStart = blockEnd = comment.line;
    }
  }
  flushBlock();
  return ranges.sort((a, b) => a.startLine - b.startLine);
}
