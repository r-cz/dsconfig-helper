/** Sent by the client with the dsconfig files found in the workspace. */
export const WORKSPACE_FILES_NOTIFICATION = 'dsconfig/workspaceFiles';

export interface WorkspaceFilesParams {
  /** When false, the server drops files it indexed from disk. */
  enabled: boolean;
  uris: string[];
}

/** Glob for files the extension indexes, matching the language's file extensions. */
export const DSCONFIG_FILE_GLOB = '**/*.{dsconfig,dsconfig.sample,dsconfig.subst,dsconfig.subst.default}';
