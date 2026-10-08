import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CodeActionKind,
  DidChangeConfigurationNotification,
  FileChangeType,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
  type InitializeResult,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Catalog } from './catalog';
import { computeCodeActions } from './codeActions';
import { computeCompletions } from './completion';
import { computeDiagnostics, type ValidationSettings } from './diagnostics';
import { DEFAULT_FORMAT_SETTINGS, formatDocument, type FormatSettings } from './formatting';
import { computeHover } from './hover';
import { documentHighlights, findDefinition, findReferences, prepareRename, rename } from './navigation';
import { ParsedDocument } from './parser';
import { documentSymbols, foldingRanges, workspaceSymbols } from './symbols';
import { WorkspaceIndex } from './workspace';
import { WORKSPACE_FILES_NOTIFICATION, type WorkspaceFilesParams } from '../protocol';

interface Settings {
  validation: ValidationSettings;
  additionalSubcommands: string[];
  format: FormatSettings;
}

const DEFAULT_SETTINGS: Settings = {
  validation: { enabled: true, unknownSubcommands: true },
  additionalSubcommands: [],
  format: DEFAULT_FORMAT_SETTINGS,
};

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const VALIDATION_DELAY = 150;

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const index = new WorkspaceIndex();
const parsed = new Map<string, { version: number; document: ParsedDocument }>();
const settingsCache = new Map<string, Promise<Settings>>();
const catalogs = new Map<string, Catalog>();
const pendingValidation = new Map<string, ReturnType<typeof setTimeout>>();
let supportsConfiguration = false;
let indexingEnabled = false;
/** Files the client reported as part of the workspace. */
const workspaceUris = new Set<string>();
/** Latest read started for each file; slower, stale reads are discarded. */
const reads = new Map<string, number>();
let readCount = 0;

function getParsed(textDocument: TextDocument): ParsedDocument {
  const cached = parsed.get(textDocument.uri);
  if (cached?.version === textDocument.version) return cached.document;
  const document = new ParsedDocument(textDocument.getText());
  parsed.set(textDocument.uri, { version: textDocument.version, document });
  index.setOpen(textDocument.uri, document);
  return document;
}

function parsedFor(uri: string): ParsedDocument | undefined {
  const textDocument = documents.get(uri);
  return textDocument ? getParsed(textDocument) : undefined;
}

function normalizeSettings(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<{
    validation: Partial<ValidationSettings>;
    additionalSubcommands: unknown;
    format: Partial<FormatSettings>;
  }>;
  const format = { ...DEFAULT_FORMAT_SETTINGS, ...value.format };
  return {
    validation: { ...DEFAULT_SETTINGS.validation, ...value.validation },
    additionalSubcommands: Array.isArray(value.additionalSubcommands)
      ? value.additionalSubcommands.filter((entry): entry is string => typeof entry === 'string')
      : [],
    format: {
      layout: ['preserve', 'multiline', 'singleline'].includes(format.layout) ? format.layout : 'preserve',
      indentSize:
        Number.isInteger(format.indentSize) && format.indentSize > 0 ? Math.min(format.indentSize, 16) : 4,
      dsconfigPrefix: ['preserve', 'add', 'remove'].includes(format.dsconfigPrefix)
        ? format.dsconfigPrefix
        : 'preserve',
    },
  };
}

function getSettings(uri: string): Promise<Settings> {
  if (!supportsConfiguration) return Promise.resolve(DEFAULT_SETTINGS);
  let settings = settingsCache.get(uri);
  if (!settings) {
    settings = connection.workspace
      .getConfiguration({ scopeUri: uri, section: 'dsconfig' })
      .then(normalizeSettings, () => DEFAULT_SETTINGS);
    settingsCache.set(uri, settings);
  }
  return settings;
}

function catalogFor(settings: Settings): Catalog {
  const key = settings.additionalSubcommands.join('\n');
  let catalog = catalogs.get(key);
  if (!catalog) {
    catalog = new Catalog(settings.additionalSubcommands);
    catalogs.set(key, catalog);
  }
  return catalog;
}

async function validate(textDocument: TextDocument): Promise<void> {
  const settings = await getSettings(textDocument.uri);
  const current = documents.get(textDocument.uri);
  if (!current || current.version !== textDocument.version) return;
  const diagnostics = computeDiagnostics(getParsed(current), catalogFor(settings), settings.validation);
  await connection.sendDiagnostics({ uri: current.uri, version: current.version, diagnostics });
}

function scheduleValidation(textDocument: TextDocument, delay = VALIDATION_DELAY): void {
  clearTimeout(pendingValidation.get(textDocument.uri));
  pendingValidation.set(
    textDocument.uri,
    setTimeout(() => {
      pendingValidation.delete(textDocument.uri);
      void validate(textDocument).catch((error: unknown) => connection.console.error(String(error)));
    }, delay),
  );
}

async function indexFile(uri: string): Promise<void> {
  if (!uri.startsWith('file:')) return;
  const read = ++readCount;
  reads.set(uri, read);
  let document: ParsedDocument | undefined;
  try {
    const path = fileURLToPath(uri);
    const info = await stat(path);
    if (info.isFile() && info.size <= MAX_FILE_SIZE)
      document = new ParsedDocument(await readFile(path, 'utf8'));
  } catch {
    // Unreadable files are dropped from the index.
  }
  // Indexing may have been reset, or a newer read started, while this one was in flight.
  if (reads.get(uri) !== read || !workspaceUris.has(uri)) return;
  if (document) index.setDisk(uri, document);
  else index.removeDisk(uri);
}

async function indexFiles(uris: string[]): Promise<void> {
  const queue = [...uris];
  const worker = async (): Promise<void> => {
    for (let uri = queue.shift(); uri !== undefined; uri = queue.shift()) await indexFile(uri);
  };
  await Promise.all(Array.from({ length: 16 }, worker));
}

connection.onInitialize((params): InitializeResult => {
  supportsConfiguration = Boolean(params.capabilities.workspace?.configuration);
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ['-', ':', '<', '{'] },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: { label: 'dsconfig' },
      workspaceSymbolProvider: true,
      foldingRangeProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite] },
    },
    serverInfo: { name: 'dsconfig-language-server' },
  };
});

connection.onInitialized(() => {
  if (supportsConfiguration) {
    void connection.client.register(DidChangeConfigurationNotification.type, { section: 'dsconfig' });
  }
});

connection.onDidChangeConfiguration(() => {
  settingsCache.clear();
  for (const textDocument of documents.all()) scheduleValidation(textDocument, 0);
});

connection.onNotification(WORKSPACE_FILES_NOTIFICATION, async (params: WorkspaceFilesParams) => {
  indexingEnabled = params.enabled;
  index.clearDisk();
  workspaceUris.clear();
  reads.clear();
  if (!indexingEnabled) return;
  for (const uri of params.uris) workspaceUris.add(uri);
  await indexFiles(params.uris);
});

connection.onDidChangeWatchedFiles(async ({ changes }) => {
  if (!indexingEnabled) return;
  for (const change of changes) {
    if (change.type === FileChangeType.Deleted) {
      workspaceUris.delete(change.uri);
      reads.delete(change.uri);
      index.removeDisk(change.uri);
    } else {
      workspaceUris.add(change.uri);
      await indexFile(change.uri);
    }
  }
});

documents.onDidChangeContent(({ document }) => {
  getParsed(document);
  scheduleValidation(document);
});

documents.onDidClose(({ document }) => {
  clearTimeout(pendingValidation.get(document.uri));
  pendingValidation.delete(document.uri);
  parsed.delete(document.uri);
  settingsCache.delete(document.uri);
  index.close(document.uri);
  // The editor copy may have had unsaved changes, so re-read the file from disk.
  if (indexingEnabled && workspaceUris.has(document.uri)) void indexFile(document.uri);
  void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

connection.onCompletion(async ({ textDocument, position }) => {
  const document = parsedFor(textDocument.uri);
  if (!document) return [];
  const settings = await getSettings(textDocument.uri);
  return computeCompletions(document, position, catalogFor(settings), index);
});

connection.onHover(async ({ textDocument, position }) => {
  const document = parsedFor(textDocument.uri);
  if (!document) return null;
  const settings = await getSettings(textDocument.uri);
  return computeHover(document, position, catalogFor(settings), index);
});

connection.onDefinition(({ textDocument, position }) => {
  const document = parsedFor(textDocument.uri);
  return document ? findDefinition(document, position, index) : [];
});

connection.onReferences(({ textDocument, position, context }) => {
  const document = parsedFor(textDocument.uri);
  return document ? findReferences(document, position, index, context.includeDeclaration) : [];
});

connection.onDocumentHighlight(({ textDocument, position }) => {
  const document = parsedFor(textDocument.uri);
  return document ? documentHighlights(document, textDocument.uri, position, index) : [];
});

connection.onPrepareRename(({ textDocument, position }) => {
  const document = parsedFor(textDocument.uri);
  return document ? prepareRename(document, position, index) : null;
});

connection.onRenameRequest(({ textDocument, position, newName }) => {
  const document = parsedFor(textDocument.uri);
  return document ? rename(document, position, newName, index) : null;
});

connection.onDocumentSymbol(({ textDocument }) => {
  const document = parsedFor(textDocument.uri);
  return document ? documentSymbols(document) : [];
});

connection.onWorkspaceSymbol(({ query }) => workspaceSymbols(index, query));

connection.onFoldingRanges(({ textDocument }) => {
  const document = parsedFor(textDocument.uri);
  return document ? foldingRanges(document) : [];
});

connection.onDocumentFormatting(async ({ textDocument }) => {
  const document = parsedFor(textDocument.uri);
  if (!document) return [];
  return formatDocument(document, (await getSettings(textDocument.uri)).format);
});

connection.onDocumentRangeFormatting(async ({ textDocument, range }) => {
  const document = parsedFor(textDocument.uri);
  if (!document) return [];
  return formatDocument(document, (await getSettings(textDocument.uri)).format, range);
});

connection.onCodeAction(async (params) => {
  const document = parsedFor(params.textDocument.uri);
  if (!document) return [];
  return computeCodeActions(document, params, (await getSettings(params.textDocument.uri)).format);
});

documents.listen(connection);
connection.listen();
