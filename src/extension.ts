import * as vscode from 'vscode';
import {
  LanguageClient,
  State,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';
import { DSCONFIG_FILE_GLOB, WORKSPACE_FILES_NOTIFICATION, type WorkspaceFilesParams } from './protocol';

const MAX_INDEXED_FILES = 5000;

let client: LanguageClient | undefined;
let syncRequest = 0;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const watcher = vscode.workspace.createFileSystemWatcher(DSCONFIG_FILE_GLOB);
  context.subscriptions.push(watcher);

  const serverModule = context.asAbsolutePath('dist/server.js');
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'dsconfig' },
      { scheme: 'untitled', language: 'dsconfig' },
    ],
    synchronize: { fileEvents: watcher },
  };

  client = new LanguageClient('dsconfig', 'dsconfig Language Server', serverOptions, clientOptions);
  // Covers the first start, manual restarts, and automatic restarts after a crash.
  client.onDidChangeState(({ newState }) => {
    if (newState === State.Running) void sendWorkspaceFiles();
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('dsconfig.restartServer', () => client?.restart()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('dsconfig.workspaceIndex')) void sendWorkspaceFiles();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void sendWorkspaceFiles()),
  );

  await client.start();
}

async function sendWorkspaceFiles(): Promise<void> {
  if (!client?.isRunning()) return;
  const request = ++syncRequest;
  const enabled = vscode.workspace.getConfiguration('dsconfig').get<boolean>('workspaceIndex.enabled', true);
  const files = enabled
    ? await vscode.workspace.findFiles(DSCONFIG_FILE_GLOB, '**/node_modules/**', MAX_INDEXED_FILES)
    : [];
  // A newer call (e.g. the setting changed again) supersedes this one.
  if (request !== syncRequest || !client.isRunning()) return;
  const params: WorkspaceFilesParams = {
    enabled,
    uris: files.filter((uri) => uri.scheme === 'file').map((uri) => uri.toString()),
  };
  await client.sendNotification(WORKSPACE_FILES_NOTIFICATION, params);
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
