import {
  CompletionItemKind,
  MarkupKind,
  type Command as LspCommand,
  type CompletionItem,
  type Position,
  type Range,
} from 'vscode-languageserver';
import {
  ASSIGNMENT_OPTIONS,
  GLOBAL_OPTIONS,
  PROPERTY_OPTIONS,
  findOption,
  isNamingOption,
  namingSpec,
  objectTypeLabel,
  optionAppliesToVerb,
  optionTakesValue,
  typesForNamingOption,
  verbOptions,
  type Catalog,
  type OptionInfo,
} from './catalog';
import { selfNamingArgument } from './model';
import type { Argument, Assignment, Command, ParsedDocument, Token } from './parser';
import { doubleQuote, quoteName } from './quoting';
import type { Counter, WorkspaceIndex } from './workspace';

const RETRIGGER: LspCommand = { title: 'Suggest', command: 'editor.action.triggerSuggest' };
const BOOLEAN_VALUES = ['true', 'false'];

interface Context {
  document: ParsedDocument;
  position: Position;
  offset: number;
  catalog: Catalog;
  index: WorkspaceIndex;
}

export function computeCompletions(
  document: ParsedDocument,
  position: Position,
  catalog: Catalog,
  index: WorkspaceIndex,
): CompletionItem[] {
  const offset = document.offsetAt(position);
  const context: Context = { document, position, offset, catalog, index };
  const lineText = document.lineText(position.line);
  if (lineText.trimStart().startsWith('#')) return [];

  let command = document.commandAtLine(position.line);
  if (!command) {
    // An empty line right after a trailing backslash continues that command.
    const previous = document.commandAtLine(position.line - 1);
    if (previous?.danglingContinuation?.line === position.line - 1) command = previous;
  }
  if (!command) {
    const wordStart = offset - (/\S*$/.exec(lineText.slice(0, position.character))?.[0].length ?? 0);
    return subcommandItems(context, lineRange(context, wordStart, offset), true, true);
  }

  const token = command.tokens.find((candidate) => candidate.start <= offset && offset <= candidate.end);
  if (token) {
    const range = tokenRange(context, token);
    const atLineEnd = lineText.slice(position.character).trim() === '';
    if (token === command.prefix || token === command.subcommand) {
      return subcommandItems(context, range, token === command.tokens[0], atLineEnd);
    }
    const argument = [...command.leadingArgs, ...command.args].find(
      (candidate) => candidate.option === token || candidate.value === token,
    );
    if (argument?.option === token) return optionItems(context, command, range, token);
    if (argument?.value === token && argument.name) return valueItems(context, command, argument, token);
    if (!command.subcommand) return subcommandItems(context, range, false, atLineEnd);
    return optionItems(context, command, range, token);
  }

  const before = command.tokens.filter((candidate) => candidate.end < offset);
  const previous = before[before.length - 1];
  const empty = lineRange(context, offset, offset);
  if (!previous || previous === command.prefix) {
    if (!command.subcommand || command.subcommand.start > offset) {
      return subcommandItems(context, empty, !previous, true);
    }
  }
  const argument = [...command.leadingArgs, ...command.args].find(
    (candidate) => candidate.option === previous,
  );
  if (argument?.name && !argument.value && optionTakesValue(argument.name, command.verb)) {
    return valueItems(context, command, argument, undefined);
  }
  if (!command.subcommand || command.subcommand.start > offset) {
    return subcommandItems(context, empty, false, true);
  }
  return optionItems(context, command, empty, undefined);
}

function lineRange(context: Context, start: number, end: number): Range {
  const lineStart = context.document.lines[context.position.line].start;
  const lineEnd = context.document.lines[context.position.line].end;
  const clampedStart = Math.max(lineStart, Math.min(start, context.offset));
  const clampedEnd = Math.min(lineEnd, Math.max(end, context.offset));
  return {
    start: context.document.positionAt(clampedStart),
    end: context.document.positionAt(clampedEnd),
  };
}

function tokenRange(context: Context, token: Token): Range {
  return lineRange(context, token.start, token.end);
}

function subcommandItems(
  context: Context,
  range: Range,
  offerPrefix: boolean,
  appendSpace: boolean,
): CompletionItem[] {
  const usage = context.index.knowledge.subcommands;
  const items: CompletionItem[] = [];
  for (const name of context.catalog.subcommands) {
    const info = context.catalog.lookup(name)!;
    const used = usage.get(name) ?? 0;
    items.push({
      label: name,
      kind: CompletionItemKind.Function,
      detail: info.description,
      sortText: `${used > 0 ? 0 : 1}${name}`,
      textEdit: { range, newText: appendSpace ? `${name} ` : name },
      command: appendSpace ? RETRIGGER : undefined,
      documentation: info.objectType
        ? {
            kind: MarkupKind.Markdown,
            value: relatedDocumentation(context.catalog, info.objectType, used),
          }
        : undefined,
    });
  }
  if (offerPrefix) {
    const prefixed = context.document.commands.filter((command) => command.prefix).length;
    items.push({
      label: 'dsconfig',
      kind: CompletionItemKind.Keyword,
      detail: 'Optional command prefix',
      sortText: `${prefixed * 2 >= context.document.commands.length && prefixed > 0 ? 0 : 2}dsconfig`,
      textEdit: { range, newText: appendSpace ? 'dsconfig ' : 'dsconfig' },
      command: appendSpace ? RETRIGGER : undefined,
    });
  }
  return items;
}

function relatedDocumentation(catalog: Catalog, objectType: string, used: number): string {
  const related = catalog.relatedSubcommands(objectType).map((name) => `\`${name}\``);
  const lines = [`**${objectTypeLabel(objectType)}**`, '', `Related: ${related.join(', ')}`];
  if (used > 0) lines.push('', `Used ${used} time${used === 1 ? '' : 's'} in this workspace.`);
  return lines.join('\n');
}

function optionItems(
  context: Context,
  command: Command,
  range: Range,
  current: Token | undefined,
): CompletionItem[] {
  const items = new Map<string, CompletionItem>();
  const present = new Set(
    [...command.leadingArgs, ...command.args]
      .filter((argument) => argument.option && argument.option !== current)
      .map((argument) => argument.name!),
  );

  const add = (name: string, group: number, info: OptionInfo | undefined, detail?: string): void => {
    if (items.has(name)) return;
    const repeatable = info ? info.repeatable : !isNamingOption(name);
    if (present.has(name) && !repeatable) return;
    const takesValue = info?.takesValue ?? true;
    items.set(name, {
      label: name,
      kind: isNamingOption(name) ? CompletionItemKind.Variable : CompletionItemKind.Keyword,
      detail: detail ?? info?.valueHint,
      documentation: info?.description,
      sortText: `${group}${name}`,
      textEdit: { range, newText: takesValue ? `${name} ` : name },
      command: takesValue ? RETRIGGER : undefined,
    });
  };

  const { verb, objectType } = command;
  if (command.subcommand && objectType) {
    const spec = namingSpec(objectType);
    const learned = context.index.knowledge.options.get(objectType) ?? new Map<string, number>();
    const learnedNaming = [...learned.keys()].filter(isNamingOption);
    for (const option of spec.parents)
      add(option, 0, undefined, `${objectTypeLabel(objectType)} parent name`);
    if (spec.self && verb !== 'list' && (spec.exact || learnedNaming.length === 0)) {
      add(
        spec.self,
        0,
        undefined,
        spec.exact ? `${objectTypeLabel(objectType)} name` : `${objectTypeLabel(objectType)} name (inferred)`,
      );
    }
    for (const option of learnedNaming) add(option, 0, undefined, `${objectTypeLabel(objectType)} name`);
    if (verb) for (const option of verbOptions(verb)) add(option.name, 1, option);
    for (const option of sortByCount(learned)) {
      if (isNamingOption(option) || (verb && !optionAppliesToVerb(option, verb))) continue;
      add(option, 2, findOption(option, verb));
    }
  } else if (command.subcommand && verb) {
    for (const option of verbOptions(verb)) add(option.name, 1, option);
  }
  for (const option of GLOBAL_OPTIONS) add(option.name, 3, option);
  return [...items.values()];
}

function valueItems(
  context: Context,
  command: Command,
  argument: Argument,
  token: Token | undefined,
): CompletionItem[] {
  const name = argument.name!;
  const envItems = environmentVariableItems(context, token);
  if (envItems) return envItems;

  if (PROPERTY_OPTIONS.has(name)) return propertyItems(context, command, argument, token);
  if (name === '--type') {
    const types = command.objectType ? context.index.knowledge.types.get(command.objectType) : undefined;
    return plainValueItems(context, token, sortByCount(types), CompletionItemKind.TypeParameter, (value) =>
      countDetail(types?.get(value)),
    );
  }
  if (isNamingOption(name)) return nameItems(context, command, argument, token);
  const values = findOption(name, command.verb)?.values ?? [];
  return plainValueItems(context, token, values, CompletionItemKind.EnumMember);
}

function environmentVariableItems(context: Context, token: Token | undefined): CompletionItem[] | undefined {
  if (!token) return undefined;
  const typed = context.document.text.slice(token.start, context.offset);
  const open = typed.lastIndexOf('${');
  if (open < 0 || typed.indexOf('}', open) >= 0) return undefined;
  const start = token.start + open;
  const rest = context.document.text.slice(context.offset, token.end);
  const close = rest.indexOf('}');
  const end =
    close >= 0 && /^[A-Za-z0-9_]*$/.test(rest.slice(0, close)) ? context.offset + close + 1 : context.offset;
  const range = lineRange(context, start, end);
  return sortByCount(context.index.knowledge.envVars).map((variable) => ({
    label: `\${${variable}}`,
    kind: CompletionItemKind.Variable,
    detail: 'Substitution variable',
    textEdit: { range, newText: `\${${variable}}` },
  }));
}

function propertyItems(
  context: Context,
  command: Command,
  argument: Argument,
  token: Token | undefined,
): CompletionItem[] {
  const name = argument.name!;
  const { knowledge } = context.index;
  const assignment = argument.assignment;
  const typeProperties = command.objectType ? knowledge.properties.get(command.objectType) : undefined;

  const inValue =
    token &&
    assignment?.operator &&
    assignment.operatorOffset !== undefined &&
    context.offset > assignment.operatorOffset;
  if (inValue && assignment.operator === '<') return []; // A file path, not a property value.
  if (inValue && assignment.valueSpan) {
    const seen = typeProperties?.get(assignment.property);
    const values = sortByCount(seen);
    if (
      /(?:^|-)enabled$/.test(assignment.property) ||
      (values.length > 0 && values.every((value) => BOOLEAN_VALUES.includes(value)))
    ) {
      for (const value of BOOLEAN_VALUES) if (!values.includes(value)) values.push(value);
    }
    return values.map((value, i) => ({
      label: value,
      kind: BOOLEAN_VALUES.includes(value) ? CompletionItemKind.Value : CompletionItemKind.Text,
      detail: countDetail(seen?.get(value)),
      sortText: String(i).padStart(4, '0'),
      ...valueEdit(context, token, assignment, value),
    }));
  }

  // Completing the property name itself.
  const properties = typeProperties?.size ? typeProperties : allProperties(context);
  const quoteOffset = token && /^["']/.test(token.raw) ? 1 : 0;
  const start = token ? token.start + quoteOffset : context.offset;
  // Stop before a closing quote, e.g. when completing inside an empty `""`.
  const end = assignment
    ? assignment.propertySpan.end
    : token?.offsets.length
      ? token.offsets[token.offsets.length - 1] + 1
      : start;
  const range = lineRange(context, start, end);
  const addOperator = ASSIGNMENT_OPTIONS.has(name) && !assignment?.operator;
  const label = command.objectType ? objectTypeLabel(command.objectType) : undefined;
  return [...properties.entries()]
    .sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0]))
    .map(([property, values], i) => ({
      label: property,
      kind: CompletionItemKind.Property,
      detail: label && typeProperties?.size ? `${label} property` : 'Property',
      documentation: valuesDocumentation(values),
      sortText: String(i).padStart(4, '0'),
      textEdit: { range, newText: addOperator ? `${property}:` : property },
      command: addOperator ? RETRIGGER : undefined,
    }));
}

/**
 * Edit that inserts a property value, escaping it for the surrounding quotes. When
 * the value can't be written as-is, the whole token is rewritten in double quotes.
 */
function valueEdit(
  context: Context,
  token: Token,
  assignment: Assignment,
  value: string,
): Pick<CompletionItem, 'textEdit' | 'filterText'> {
  const quote = /^["']/.test(token.raw) ? token.raw[0] : undefined;
  const special = /[\s"'\\]/.test(value);
  if (quote === '"') {
    const range = lineRange(context, assignment.valueSpan!.start, assignment.valueSpan!.end);
    return { textEdit: { range, newText: doubleQuote(value).slice(1, -1) } };
  }
  if ((quote === "'" && !value.includes("'")) || (!token.quoted && !special)) {
    const range = lineRange(context, assignment.valueSpan!.start, assignment.valueSpan!.end);
    return { textEdit: { range, newText: value } };
  }
  const full = `${assignment.property}${assignment.operator}${value}`;
  return {
    filterText: `${quote ?? ''}${full}`,
    textEdit: { range: tokenRange(context, token), newText: doubleQuote(full) },
  };
}

function allProperties(context: Context): Map<string, Counter> {
  const merged = new Map<string, Counter>();
  for (const properties of context.index.knowledge.properties.values()) {
    for (const [property, values] of properties) {
      const target = merged.get(property) ?? new Map<string, number>();
      for (const [value, count] of values) target.set(value, (target.get(value) ?? 0) + count);
      merged.set(property, target);
    }
  }
  return merged;
}

function nameItems(
  context: Context,
  command: Command,
  argument: Argument,
  token: Token | undefined,
): CompletionItem[] {
  const option = argument.name!;
  const isSelf =
    selfNamingArgument(command) === argument ||
    (!argument.value && namingSpec(command.objectType ?? '').self === option);
  const types = isSelf && command.objectType ? [command.objectType] : typesForNamingOption(option);
  const candidates = [...context.index.knowledge.objects.values()].filter((object) =>
    object.objectType ? types.includes(object.objectType) : object.option === option,
  );
  const range = token ? tokenRange(context, token) : lineRange(context, context.offset, context.offset);
  const typedQuote = token && /^["']/.test(token.raw) ? token.raw[0] : '';
  return candidates
    .sort((a, b) => b.definitions.length - a.definitions.length || b.references.length - a.references.length)
    .map((object, i) => {
      const newText = quoteName(object.name, token?.raw ?? '');
      return {
        label: object.name,
        kind: CompletionItemKind.Reference,
        detail: object.objectType ? objectTypeLabel(object.objectType) : undefined,
        documentation:
          object.definitions.length > 0
            ? 'Created in this workspace'
            : `Referenced ${object.references.length} time(s)`,
        sortText: String(i).padStart(4, '0'),
        filterText: `${typedQuote}${object.name}`,
        textEdit: { range, newText },
      };
    });
}

function plainValueItems(
  context: Context,
  token: Token | undefined,
  values: readonly string[],
  kind: CompletionItemKind,
  detail?: (value: string) => string | undefined,
): CompletionItem[] {
  const range = token ? tokenRange(context, token) : lineRange(context, context.offset, context.offset);
  return values.map((value, i) => ({
    label: value,
    kind,
    detail: detail?.(value),
    sortText: String(i).padStart(4, '0'),
    textEdit: { range, newText: /\s/.test(value) ? `"${value}"` : value },
  }));
}

function sortByCount(counter: Counter | undefined): string[] {
  if (!counter) return [];
  return [...counter.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
}

function total(counter: Counter): number {
  let sum = 1;
  for (const count of counter.values()) sum += count;
  return sum;
}

function countDetail(count: number | undefined): string | undefined {
  return count ? `Used ${count} time${count === 1 ? '' : 's'} in this workspace` : undefined;
}

function valuesDocumentation(values: Counter): string | undefined {
  const top = sortByCount(values).slice(0, 5);
  return top.length > 0 ? `Values in this workspace: ${top.join(', ')}` : undefined;
}
