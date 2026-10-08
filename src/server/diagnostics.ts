import { DiagnosticSeverity, type Diagnostic, type TextEdit } from 'vscode-languageserver';
import {
  ASSIGNMENT_OPTIONS,
  findOption,
  isNamingOption,
  namingSpec,
  optionAppliesToVerb,
  parseSubcommandName,
  type Catalog,
  type Verb,
} from './catalog';
import { isBarePropertyName, type Argument, type Command, type ParsedDocument, type Span } from './parser';

export interface ValidationSettings {
  enabled: boolean;
  unknownSubcommands: boolean;
}

export const DiagnosticCode = {
  unterminatedQuote: 'unterminated-quote',
  danglingContinuation: 'dangling-continuation',
  missingContinuation: 'missing-continuation',
  missingSubcommand: 'missing-subcommand',
  unknownSubcommand: 'unknown-subcommand',
  missingValue: 'missing-value',
  malformedAssignment: 'malformed-assignment',
  unexpectedAssignment: 'unexpected-assignment',
  invalidOption: 'invalid-option',
  duplicateOption: 'duplicate-option',
  conflictingProperty: 'conflicting-property',
  missingNamingArgument: 'missing-naming-argument',
  unexpectedArgument: 'unexpected-argument',
} as const;

export interface QuickFix {
  title: string;
  edits: TextEdit[];
  preferred?: boolean;
}

export interface DiagnosticData {
  fixes?: QuickFix[];
}

const SOURCE = 'dsconfig';

export function computeDiagnostics(
  document: ParsedDocument,
  catalog: Catalog,
  settings: ValidationSettings,
): Diagnostic[] {
  if (!settings.enabled) return [];
  const diagnostics: Diagnostic[] = [];

  const report = (
    span: Span,
    severity: DiagnosticSeverity,
    code: string,
    message: string,
    fixes?: QuickFix[],
  ): void => {
    const diagnostic: Diagnostic = {
      range: document.rangeOf(span),
      severity,
      code,
      source: SOURCE,
      message,
    };
    if (fixes?.length) diagnostic.data = { fixes } satisfies DiagnosticData;
    diagnostics.push(diagnostic);
  };

  const replace = (span: Span, newText: string): TextEdit => ({ range: document.rangeOf(span), newText });

  document.commands.forEach((command, index) => {
    for (const token of command.tokens) {
      if (token.unterminatedQuote === undefined) continue;
      const quote = document.text[token.unterminatedQuote];
      report(
        { start: token.unterminatedQuote, end: token.end },
        DiagnosticSeverity.Error,
        DiagnosticCode.unterminatedQuote,
        `Unterminated string: missing closing ${quote === '"' ? 'double' : 'single'} quote.`,
        [
          {
            title: `Add closing ${quote}`,
            edits: [replace({ start: token.end, end: token.end }, quote)],
            preferred: true,
          },
        ],
      );
    }

    if (command.danglingContinuation) {
      const { offset, line } = command.danglingContinuation;
      const lineStart = document.lines[line].start;
      const before = document.text.slice(lineStart, offset);
      const trimmedStart = lineStart + before.trimEnd().length;
      report(
        { start: offset, end: offset + 1 },
        DiagnosticSeverity.Warning,
        DiagnosticCode.danglingContinuation,
        'Line continuation is not followed by another line of this command.',
        [
          {
            title: 'Remove line continuation',
            edits: [replace({ start: trimmedStart, end: document.lines[line].end }, '')],
            preferred: true,
          },
        ],
      );
    }

    if (!command.subcommand) {
      reportMissingSubcommand(document, command, document.commands[index - 1], report);
      return;
    }

    const subcommand = command.subcommand;
    const name = subcommand.value;
    const info = catalog.lookup(name);
    if (!info && settings.unknownSubcommands && !name.includes('${')) {
      const suggestions = catalog.suggest(name);
      const fixes = suggestions.map((suggestion, i) => ({
        title: `Change to '${suggestion}'`,
        edits: [replace(subcommand, suggestion)],
        preferred: i === 0,
      }));
      if (suggestions.length > 0) {
        report(
          subcommand,
          DiagnosticSeverity.Warning,
          DiagnosticCode.unknownSubcommand,
          `Unknown subcommand '${name}'. Did you mean '${suggestions[0]}'?`,
          fixes,
        );
      } else if (parseSubcommandName(name)) {
        report(
          subcommand,
          DiagnosticSeverity.Information,
          DiagnosticCode.unknownSubcommand,
          `'${name}' is not a known PingDirectory subcommand. If it comes from another Ping product, add it to the dsconfig.additionalSubcommands setting.`,
        );
      } else {
        report(
          subcommand,
          DiagnosticSeverity.Warning,
          DiagnosticCode.unknownSubcommand,
          `'${name}' is not a dsconfig subcommand. Subcommands start with create-, delete-, get-, set-, or list-.`,
        );
      }
    }

    // `list-properties` has its own options (`--type`, `--category`), so only check typed subcommands.
    const builtinVerb = info?.builtin && info.objectType ? info.verb : undefined;
    validateArguments(command, builtinVerb, report, replace);
    if (info?.builtin && info.objectType && info.verb) {
      validateNamingArguments(command, info.verb, info.objectType, report);
    }
  });

  return diagnostics;
}

type Report = (
  span: Span,
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  fixes?: QuickFix[],
) => void;

type Replace = (span: Span, newText: string) => TextEdit;

function reportMissingSubcommand(
  document: ParsedDocument,
  command: Command,
  previous: Command | undefined,
  report: Report,
): void {
  const first = command.tokens[0];
  // A line holding only a dangling `\` has no tokens; the dangling warning covers it.
  if (!first) return;
  if (command.prefix && command.tokens.length === 1) {
    report(
      first,
      DiagnosticSeverity.Error,
      DiagnosticCode.missingSubcommand,
      "Expected a subcommand after 'dsconfig'.",
    );
    return;
  }
  const startsWithOption = command.leadingArgs.length > 0 && !command.prefix;
  if (
    startsWithOption &&
    previous &&
    previous.endLine === command.startLine - 1 &&
    !previous.danglingContinuation
  ) {
    const end = document.lines[previous.endLine].end;
    const lineText = document.lineText(previous.endLine);
    const trimmedEnd = document.lines[previous.endLine].start + lineText.trimEnd().length;
    report(
      { start: command.start, end: document.lines[command.startLine].end },
      DiagnosticSeverity.Error,
      DiagnosticCode.missingContinuation,
      "This line looks like part of the previous command, but the previous line doesn't end with '\\'.",
      [
        {
          title: "Add '\\' to the end of the previous line",
          edits: [{ range: document.rangeOf({ start: trimmedEnd, end }), newText: ' \\' }],
          preferred: true,
        },
      ],
    );
    return;
  }
  report(
    first,
    DiagnosticSeverity.Error,
    DiagnosticCode.missingSubcommand,
    'Expected a dsconfig subcommand.',
  );
}

function validateArguments(command: Command, verb: Verb | undefined, report: Report, replace: Replace): void {
  const seen = new Set<string>();
  const reset = new Map<string, Argument>();
  const assigned = new Set<string>();

  for (const argument of command.args) {
    const { option, value, name } = argument;
    if (!option || !name) {
      // A bare token that no option consumed; usually an unquoted value with spaces.
      const previous = command.args[command.args.indexOf(argument) - 1];
      const hint = previous?.value ? ' If it is part of the previous value, wrap that value in quotes.' : '';
      report(
        value!,
        DiagnosticSeverity.Warning,
        DiagnosticCode.unexpectedArgument,
        `Unexpected argument '${value!.value}'.${hint}`,
      );
      continue;
    }

    const known = findOption(name, verb);
    if (verb && !optionAppliesToVerb(name, verb)) {
      const fixes: QuickFix[] =
        verb === 'create' && name === '--add'
          ? [{ title: "Change to '--set'", edits: [replace(option, '--set')], preferred: true }]
          : [];
      report(
        option,
        DiagnosticSeverity.Warning,
        DiagnosticCode.invalidOption,
        `'${name}' can't be used with ${verb}-* subcommands.`,
        fixes,
      );
    }

    // Unknown options might be repeatable; only naming arguments are known not to be.
    const repeatable = known ? Boolean(known.repeatable) : !isNamingOption(name);
    if (seen.has(name) && !repeatable) {
      report(
        option,
        DiagnosticSeverity.Warning,
        DiagnosticCode.duplicateOption,
        `Duplicate option '${name}'.`,
      );
    }
    seen.add(name);

    const requiresValue = known?.takesValue ?? isNamingOption(name);
    if (!value) {
      if (requiresValue) {
        const expected = ASSIGNMENT_OPTIONS.has(name)
          ? 'property assignment (name:value)'
          : name === '--reset' || name === '--property'
            ? 'property name'
            : 'value';
        report(
          option,
          DiagnosticSeverity.Error,
          DiagnosticCode.missingValue,
          `Expected ${expected} after ${name}.`,
        );
      }
      continue;
    }
    if (value.value.includes('${')) continue;

    const assignment = argument.assignment;
    if (ASSIGNMENT_OPTIONS.has(name)) {
      if (!assignment?.operator) {
        report(
          value,
          DiagnosticSeverity.Error,
          DiagnosticCode.malformedAssignment,
          'Expected property assignment in the form name:value or name<file.',
        );
      } else {
        assigned.add(assignment.property);
      }
    } else if (name === '--reset' || name === '--property') {
      if (assignment?.operator && assignment.operatorOffset !== undefined) {
        report(
          { start: assignment.operatorOffset, end: value.offsets[value.offsets.length - 1] + 1 },
          DiagnosticSeverity.Error,
          DiagnosticCode.unexpectedAssignment,
          `${name} takes a property name, not an assignment.`,
          [
            {
              title: `Remove the value from ${name}`,
              edits: [replace(value, assignment.property)],
              preferred: true,
            },
          ],
        );
      } else if (!isBarePropertyName(argument)) {
        report(
          value,
          DiagnosticSeverity.Error,
          DiagnosticCode.malformedAssignment,
          `Expected property name after ${name}.`,
        );
      }
      if (name === '--reset' && assignment) reset.set(assignment.property, argument);
    }
  }

  for (const [property, argument] of reset) {
    if (assigned.has(property)) {
      report(
        argument.value!,
        DiagnosticSeverity.Warning,
        DiagnosticCode.conflictingProperty,
        `Property '${property}' is both reset and assigned in this command.`,
      );
    }
  }
}

function validateNamingArguments(command: Command, verb: Verb, objectType: string, report: Report): void {
  const spec = namingSpec(objectType);
  if (!spec.exact) return;
  const required = verb === 'list' ? spec.parents : spec.self ? [...spec.parents, spec.self] : spec.parents;
  const present = new Set(command.args.map((argument) => argument.name));
  const missing = required.filter((option) => !present.has(option));
  if (missing.length > 0) {
    report(
      command.subcommand!,
      DiagnosticSeverity.Warning,
      DiagnosticCode.missingNamingArgument,
      `${command.subcommand!.value} requires ${missing.join(' and ')}.`,
    );
  }
}
