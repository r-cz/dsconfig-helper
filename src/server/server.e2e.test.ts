import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
  type CompletionItem,
  type Location,
  type MessageConnection,
  type PublishDiagnosticsParams,
  type SymbolInformation,
  type TextEdit,
} from 'vscode-languageserver/node';
import { build } from '../../scripts/build';
import { WORKSPACE_FILES_NOTIFICATION } from '../protocol';

// Exercises the bundled server the way VS Code runs it: a separate Node process speaking LSP.
let directory: string;
let server: ChildProcess;
let connection: MessageConnection;
const diagnostics: PublishDiagnosticsParams[] = [];

const CURRENT = [
  'dsconfig set-backend-prop --backend-name userRoot --set enabled:true',
  'dsconfig crate-backend --backend-name other',
  'dsconfig set-policy-decision-service-prop --set pdp-mode:embedded',
  'dsconfig set-backend-prop   --backend-name userRoot --',
].join('\n');

async function until<T>(
  read: () => Promise<T> | T,
  accept: (value: T) => boolean,
  timeout = 5000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`);
    await Bun.sleep(25);
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsconfig-e2e-'));
  await build({ outdir: join(directory, 'dist') });
  await writeFile(
    join(directory, 'backends.dsconfig'),
    'dsconfig create-backend --backend-name userRoot --type local-db --set base-dn:dc=example,dc=com\n',
  );

  server = spawn(Bun.which('node') ?? process.execPath, [join(directory, 'dist/server.js'), '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  connection = createMessageConnection(
    new StreamMessageReader(server.stdout!),
    new StreamMessageWriter(server.stdin!),
  );
  connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => {
    diagnostics.push(params);
  });
  connection.onRequest('workspace/configuration', () => [
    { additionalSubcommands: ['set-policy-decision-service-prop'] },
  ]);
  connection.onRequest('client/registerCapability', () => null);
  connection.listen();

  await connection.sendRequest('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(directory).toString(),
    capabilities: {
      workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } },
    },
  });
  await connection.sendNotification('initialized', {});
  await connection.sendNotification(WORKSPACE_FILES_NOTIFICATION, {
    enabled: true,
    uris: [pathToFileURL(join(directory, 'backends.dsconfig')).toString()],
  });
  await connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri: 'file:///current.dsconfig', languageId: 'dsconfig', version: 1, text: CURRENT },
  });
}, 30_000);

afterAll(async () => {
  if (connection) {
    await connection.sendRequest('shutdown').catch(() => undefined);
    await connection.sendNotification('exit').catch(() => undefined);
    connection.dispose();
  }
  server?.kill();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('bundled language server', () => {
  it('publishes diagnostics using workspace settings', async () => {
    const published = await until(
      () => diagnostics.find((params) => params.uri === 'file:///current.dsconfig'),
      (params) => params !== undefined,
    );
    expect(
      published!.diagnostics.map((diagnostic) => [diagnostic.range.start.line, diagnostic.code]),
    ).toEqual([[1, 'unknown-subcommand']]);
  });

  it('resolves definitions from files indexed on disk', async () => {
    const locations = await until(
      () =>
        connection.sendRequest<Location[]>('textDocument/definition', {
          textDocument: { uri: 'file:///current.dsconfig' },
          position: { line: 0, character: 45 },
        }),
      (result) => result.length > 0,
    );
    expect(locations[0].uri).toEndWith('/backends.dsconfig');
  });

  it('completes options', async () => {
    const items = await connection.sendRequest<CompletionItem[]>('textDocument/completion', {
      textDocument: { uri: 'file:///current.dsconfig' },
      position: { line: 3, character: 53 },
    });
    expect(items.map((item) => item.label)).toContain('--set');
  });

  it('drops disk files when indexing is turned off mid-scan', async () => {
    const backends = pathToFileURL(join(directory, 'backends.dsconfig')).toString();
    await connection.sendNotification(WORKSPACE_FILES_NOTIFICATION, { enabled: true, uris: [backends] });
    await connection.sendNotification(WORKSPACE_FILES_NOTIFICATION, { enabled: false, uris: [] });
    await Bun.sleep(300);
    const symbols = await connection.sendRequest<SymbolInformation[]>('workspace/symbol', {
      query: 'create-backend',
    });
    expect(symbols.filter((symbol) => symbol.location.uri === backends)).toEqual([]);
  });

  it('formats documents', async () => {
    const edits = await connection.sendRequest<TextEdit[]>('textDocument/formatting', {
      textDocument: { uri: 'file:///current.dsconfig' },
      options: { tabSize: 4, insertSpaces: true },
    });
    expect(edits.map((edit) => edit.newText)).toEqual([
      'dsconfig set-backend-prop --backend-name userRoot --',
    ]);
  });
});
