import type { Position } from 'vscode-languageserver';
import { ParsedDocument } from './parser';
import { WorkspaceIndex } from './workspace';

/** Parses text containing a `|` cursor marker and returns the cursor position. */
export function withCursor(textWithCursor: string): { document: ParsedDocument; position: Position } {
  const offset = textWithCursor.indexOf('|');
  if (offset < 0) throw new Error('Missing | cursor marker');
  const document = new ParsedDocument(textWithCursor.slice(0, offset) + textWithCursor.slice(offset + 1));
  return { document, position: document.positionAt(offset) };
}

/** Builds an index from `uri → text` pairs. */
export function indexOf(files: Record<string, string | ParsedDocument>): WorkspaceIndex {
  const index = new WorkspaceIndex();
  for (const [uri, content] of Object.entries(files)) {
    index.setOpen(uri, typeof content === 'string' ? new ParsedDocument(content) : content);
  }
  return index;
}

export const lines = (...rows: string[]): string => rows.join('\n');
