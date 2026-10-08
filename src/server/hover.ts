import { MarkupKind, type Hover, type Position } from 'vscode-languageserver';
import { uriBasename, locationLink } from './links';
import { findOption, isNamingOption, objectTypeLabel, type Catalog } from './catalog';
import { referenceAt } from './model';
import type { ParsedDocument, Token } from './parser';
import type { WorkspaceIndex } from './workspace';

export function computeHover(
  document: ParsedDocument,
  position: Position,
  catalog: Catalog,
  index: WorkspaceIndex,
): Hover | null {
  const offset = document.offsetAt(position);
  const command = document.commandAtLine(position.line);
  if (!command) return null;
  const token = command.tokens.find((candidate) => candidate.start <= offset && offset < candidate.end);
  if (!token) return null;

  const hover = (lines: string[], span: { start: number; end: number } = token): Hover => ({
    contents: { kind: MarkupKind.Markdown, value: lines.join('\n') },
    range: document.rangeOf(span),
  });

  if (token === command.prefix) {
    return hover([
      '**dsconfig**',
      '',
      'Optional prefix. Batch files may list subcommands with or without it.',
    ]);
  }

  if (token === command.subcommand) {
    const info = catalog.lookup(token.value);
    if (!info) {
      const suggestions = catalog.suggest(token.value);
      return hover([
        `**${token.value}**`,
        '',
        'Not a known PingDirectory subcommand.',
        ...(suggestions.length
          ? ['', `Did you mean ${suggestions.map((name) => `\`${name}\``).join(', ')}?`]
          : []),
      ]);
    }
    const lines = [`**${info.name}**`, '', info.description];
    if (info.objectType) {
      const related = catalog.relatedSubcommands(info.objectType).filter((name) => name !== info.name);
      if (related.length) lines.push('', `Related: ${related.map((name) => `\`${name}\``).join(', ')}`);
    }
    return hover(lines);
  }

  const argument = [...command.leadingArgs, ...command.args].find(
    (candidate) => candidate.option === token || candidate.value === token,
  );
  if (!argument?.name) return null;

  if (argument.option === token) {
    const info = findOption(argument.name, command.verb);
    if (info) {
      const signature = [info.name, ...(info.aliases ?? [])].join(', ');
      return hover([
        `**${signature}**${info.valueHint ? ` \`${info.valueHint}\`` : ''}`,
        '',
        info.description,
      ]);
    }
    if (isNamingOption(argument.name)) {
      const reference = referenceAt(command, argument.value?.start ?? -1);
      const type = reference?.objectType;
      const what = type ? objectTypeLabel(type) : 'configuration object';
      return hover([
        `**${argument.name}** \`{name}\``,
        '',
        reference && !reference.isSelf ? `Name of the parent ${what}.` : `Name of the ${what}.`,
      ]);
    }
    return null;
  }

  const variable = variableAt(token, offset);
  if (variable) {
    const count = index.knowledge.envVars.get(variable.name) ?? 0;
    return hover(
      [
        `**\${${variable.name}}**`,
        '',
        'Substitution variable, replaced when the server profile is applied.',
        '',
        `Used ${count} time${count === 1 ? '' : 's'} in this workspace.`,
      ],
      variable,
    );
  }

  const assignment = argument.assignment;
  if (assignment && offset < assignment.propertySpan.end) {
    const type = command.objectType;
    const values = type ? index.knowledge.properties.get(type)?.get(assignment.property) : undefined;
    const lines = [
      `**${assignment.property}**`,
      '',
      type ? `${objectTypeLabel(type)} property.` : 'Property.',
    ];
    if (values?.size) {
      const top = [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      lines.push(
        '',
        'Values in this workspace:',
        ...top.map(([value, count]) => `- \`${value}\` (${count})`),
      );
    }
    return hover(lines, assignment.propertySpan);
  }

  if (argument.name === '--type' && command.objectType) {
    return hover([`**${token.value}**`, '', `${objectTypeLabel(command.objectType)} type.`]);
  }

  const reference = referenceAt(command, offset);
  if (reference) {
    const object = index.resolve(reference);
    const label = reference.objectType ? objectTypeLabel(reference.objectType) : 'Object';
    const lines = [`**${label}** \`${reference.name}\``];
    if (object?.definitions.length) {
      lines.push(
        '',
        'Created in:',
        ...object.definitions.map(
          (definition) => `- ${locationLink(definition.uri, definition.range.start.line)}`,
        ),
      );
    } else {
      lines.push('', 'Not created in the indexed files. It may be built in to the server.');
    }
    const count = object?.references.length ?? 0;
    if (count > 1)
      lines.push(
        '',
        `Referenced ${count} times in ${new Set(object!.references.map((ref) => uriBasename(ref.uri))).size} file(s).`,
      );
    return hover(lines);
  }

  return null;
}

function variableAt(token: Token, offset: number): { name: string; start: number; end: number } | undefined {
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  for (const match of token.raw.matchAll(pattern)) {
    const start = token.start + match.index!;
    const end = start + match[0].length;
    if (offset >= start && offset < end) return { name: match[1], start, end };
  }
  return undefined;
}
