# dsconfig Helper

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/RyanCruz.dsconfig-helper)](https://marketplace.visualstudio.com/items?itemName=RyanCruz.dsconfig-helper)

Language support for PingDirectory `dsconfig` batch files (`.dsconfig`, `.dsconfig.subst`, and friends), such as the ones in server profiles.

## Features

### Validation with quick fixes

Problems are flagged as you type, and most come with a one-click fix:

| Problem                                                            | Quick fix                    |
| ------------------------------------------------------------------ | ---------------------------- |
| Misspelled subcommand (`crate-backend`, `set-backend`)             | Change to the closest match  |
| Forgotten `\` line continuation                                    | Add `\` to the previous line |
| Trailing `\` followed by a blank line or the end of the file       | Remove the continuation      |
| Unterminated quote                                                 | Add the closing quote        |
| `--reset name:value`                                               | Drop the value               |
| `--add` on a `create-*` subcommand                                 | Change to `--set`            |
| Malformed `--set` (missing `name:value` or `name<file`)            |                              |
| Option without a value, duplicate naming arguments or `--type`     |                              |
| Options that don't apply (`--set` on `get-*`, `--type` on `set-*`) |                              |
| A property that is both `--reset` and assigned in one command      |                              |
| Unquoted value with spaces                                         |                              |
| Missing parent name (e.g. `--backend-name` for a local DB index)   |                              |

Multi-line commands are parsed as a whole, so arguments split across continuation lines are checked correctly. As in dsconfig batch files, `#` lines inside a continued command are skipped, so you can comment out a single argument line. Values built from `${VARIABLES}` are not second-guessed.

### Context-aware completion

- **Subcommands**: all PingDirectory subcommands, with the ones your workspace uses ranked first.
- **Options**: naming arguments (`--backend-name`, `--index-name`, ...) first, then the options valid for the subcommand's verb, then global options.
- **Properties and values**: after `--set`, `--add`, `--remove`, `--reset`, or `--property`, you get properties and values learned from every dsconfig file in the workspace for that object type, plus `true`/`false` for `enabled` properties. Values with spaces are quoted automatically.
- **Object names**: after `--backend-name` and friends, you get the objects created or referenced across the workspace.
- **`--type` values** and **`${SUBSTITUTION_VARIABLES}`** seen in the workspace.

### Navigation

- **Go to Definition** (F12) on an object name jumps to the `create-*` command that defines it, even in another file.
- **Find All References** (Shift+F12) and **Rename Symbol** (F2) work across the workspace. Rename keeps quoting correct.
- **Hover** shows what a subcommand does, option documentation, property values used in the workspace, and where an object is created.
- **Outline and breadcrumbs** list every command by subcommand and object name, grouped under `# region Name` / `# endregion` comments.
- **Go to Symbol in Workspace** (Ctrl/Cmd+T) searches every command in every dsconfig file.
- **Folding** for multi-line commands, comment blocks, and regions.

### Formatting

**Format Document** and **Format Selection** normalize spacing, indentation, and continuation markers. With `"dsconfig.format.layout": "multiline"`, every argument goes on its own line:

```
dsconfig create-backend \
    --backend-name userRoot \
    --type local-db \
    --set base-dn:dc=example,dc=com
```

The **Split command across lines** and **Join command onto one line** refactorings (Ctrl/Cmd+.) work on a single command regardless of the setting. Pressing Enter after a trailing `\` indents the next line automatically.

### Highlighting and snippets

Syntax highlighting distinguishes subcommands, options, property names, object names, `--type` values, substitution variables, and comments. Snippets cover common tasks: `create-backend`, `create-local-db-index`, `create-pass-through-authentication-handler`, `dsconfig-command`, `set-password-policy-prop`, `set-log-publisher-prop`, `set-log-publisher-severity`, `set-global-configuration-prop`, `set-pass-through-authentication-handler-prop`, `set-plugin-prop`, `extension-argument-request-header`, `extension-argument-client-secret`, and `-value` variants of the last two for use after an existing `--set`.

## Settings

| Setting                                  | Default    | Description                                                                                                                 |
| ---------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `dsconfig.validation.enabled`            | `true`     | Report problems in dsconfig files.                                                                                          |
| `dsconfig.validation.unknownSubcommands` | `true`     | Report subcommands missing from the built-in catalog. Likely typos are warnings; other unknown subcommands are information. |
| `dsconfig.additionalSubcommands`         | `[]`       | Extra subcommands to treat as known, e.g. from PingAuthorize or PingDataSync (`set-policy-decision-service-prop`).          |
| `dsconfig.format.layout`                 | `preserve` | `preserve` keeps line breaks, `multiline` puts each argument on its own line, `singleline` joins each command.              |
| `dsconfig.format.indentSize`             | `4`        | Spaces used to indent continuation lines.                                                                                   |
| `dsconfig.format.dsconfigPrefix`         | `preserve` | `add` or `remove` the leading `dsconfig` keyword when formatting.                                                           |
| `dsconfig.workspaceIndex.enabled`        | `true`     | Index dsconfig files across the workspace for completion, navigation, and workspace symbols.                                |

Run **dsconfig: Restart Language Server** from the Command Palette if anything gets stuck.

## How it learns properties

PingDirectory's property definitions aren't published in a machine-readable form, so the extension doesn't ship a property catalog. Instead it learns properties, values, `--type` values, and object names from the dsconfig files in your workspace. The more configuration a workspace contains, such as a full server profile, the better the suggestions get.

## Development

Requires [Bun](https://bun.sh) and Node.js 22+.

```sh
bun install
bun run check     # typecheck, lint, format check, and tests
bun run build     # bundle to dist/
bun run package   # build a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host with `examples/` open. Use the **Attach to Language Server** launch configuration to debug the server.

The language server is plain TypeScript with no VS Code dependency. Most logic is pure functions over a parsed document, tested with `bun test`. `src/server/server.e2e.test.ts` builds the bundle and drives it over LSP the way VS Code does.

| Path                      | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `src/extension.ts`        | VS Code client: starts the server, feeds it workspace files      |
| `src/server/parser.ts`    | Splits files into commands, handling continuations and quotes    |
| `src/server/catalog.ts`   | Subcommands, options, and object-type naming rules               |
| `src/server/workspace.ts` | Cross-file index of objects, properties, and values              |
| `src/server/*.ts`         | One module per LSP feature (completion, diagnostics, hover, ...) |
| `syntaxes/`               | TextMate grammar, tested in `src/grammar.test.ts`                |

## Release

1. Use Conventional Commits (e.g. `feat: add snippet`, `fix: tweak grammar`).
2. Merge to `main` and Release Please opens a release PR.
3. Merge the release PR to create the GitHub release and tag.
4. The publish workflow tests, packages, and publishes the VSIX to the Marketplace, then attaches it to the release.
5. `VSCE_PAT` must be set as a GitHub Actions secret (Marketplace Manage scope).

## Notes

PingDirectory is a trademark of Ping Identity. This extension is not affiliated with or endorsed by Ping Identity.
