import { CodeActionKind, type CodeAction, type CodeActionParams } from 'vscode-languageserver';
import type { DiagnosticData } from './diagnostics';
import { formatCommand, type FormatSettings } from './formatting';
import type { ParsedDocument } from './parser';

export function computeCodeActions(
  document: ParsedDocument,
  params: CodeActionParams,
  settings: FormatSettings,
): CodeAction[] {
  const uri = params.textDocument.uri;
  const actions: CodeAction[] = [];

  for (const diagnostic of params.context.diagnostics) {
    const data = diagnostic.data as DiagnosticData | undefined;
    for (const fix of data?.fixes ?? []) {
      actions.push({
        title: fix.title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        isPreferred: fix.preferred,
        edit: { changes: { [uri]: fix.edits } },
      });
    }
  }

  const command = document.commandAtLine(params.range.start.line);
  if (command?.subcommand && command.args.length > 0) {
    const multiline = command.endLine > command.startLine;
    const layout = multiline ? 'singleline' : 'multiline';
    const newText = formatCommand(document, command, { ...settings, dsconfigPrefix: 'preserve' }, layout);
    if (newText !== undefined) {
      const last = document.lines[command.endLine];
      actions.push({
        title: multiline ? 'Join command onto one line' : 'Split command across lines',
        kind: CodeActionKind.RefactorRewrite,
        edit: {
          changes: {
            [uri]: [
              {
                range: {
                  start: { line: command.startLine, character: 0 },
                  end: { line: command.endLine, character: last.end - last.start },
                },
                newText,
              },
            ],
          },
        },
      });
    }
  }

  return actions;
}
