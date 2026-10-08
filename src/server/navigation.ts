import {
  DocumentHighlightKind,
  type DocumentHighlight,
  type Location,
  type Position,
  type Range,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import { referenceAt, type NameReference } from './model';
import type { ParsedDocument } from './parser';
import { quoteName } from './quoting';
import type { NamedObject, Occurrence, WorkspaceIndex } from './workspace';

function lookup(
  document: ParsedDocument,
  position: Position,
  index: WorkspaceIndex,
): { reference: NameReference; object: NamedObject | undefined } | undefined {
  const command = document.commandAtLine(position.line);
  if (!command) return undefined;
  const reference = referenceAt(command, document.offsetAt(position));
  if (!reference) return undefined;
  return { reference, object: index.resolve(reference) };
}

const toLocation = (occurrence: Occurrence): Location => ({ uri: occurrence.uri, range: occurrence.range });

export function findDefinition(
  document: ParsedDocument,
  position: Position,
  index: WorkspaceIndex,
): Location[] {
  return lookup(document, position, index)?.object?.definitions.map(toLocation) ?? [];
}

export function findReferences(
  document: ParsedDocument,
  position: Position,
  index: WorkspaceIndex,
  includeDeclaration: boolean,
): Location[] {
  const object = lookup(document, position, index)?.object;
  if (!object) return [];
  return object.references
    .filter((occurrence) => includeDeclaration || !occurrence.reference.isDefinition)
    .map(toLocation);
}

export function documentHighlights(
  document: ParsedDocument,
  uri: string,
  position: Position,
  index: WorkspaceIndex,
): DocumentHighlight[] {
  const object = lookup(document, position, index)?.object;
  if (!object) return [];
  return object.references
    .filter((occurrence) => occurrence.uri === uri)
    .map((occurrence) => ({
      range: occurrence.range,
      kind: occurrence.reference.isDefinition ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
    }));
}

export function prepareRename(
  document: ParsedDocument,
  position: Position,
  index: WorkspaceIndex,
): { range: Range; placeholder: string } | null {
  const found = lookup(document, position, index);
  if (!found) return null;
  return { range: document.rangeOf(found.reference.token), placeholder: found.reference.name };
}

export function rename(
  document: ParsedDocument,
  position: Position,
  newName: string,
  index: WorkspaceIndex,
): WorkspaceEdit | null {
  const object = lookup(document, position, index)?.object;
  if (!object) return null;
  const changes: Record<string, TextEdit[]> = {};
  for (const occurrence of object.references) {
    const edits = (changes[occurrence.uri] ??= []);
    edits.push({ range: occurrence.range, newText: quoteName(newName, occurrence.reference.token.raw) });
  }
  return { changes };
}
