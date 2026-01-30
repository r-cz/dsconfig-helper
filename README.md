# .dsconfig Helper VS Code Extension

[![VS Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/RyanCruz.dsconfig-helper)](https://marketplace.visualstudio.com/items?itemName=RyanCruz.dsconfig-helper)
[![VS Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/RyanCruz.dsconfig-helper)](https://marketplace.visualstudio.com/items?itemName=RyanCruz.dsconfig-helper)

Language support for PingDirectory `.dsconfig` batch files.

Features

- Syntax highlighting for subcommands, options, properties, values, and comments
- Snippets for common PingDirectory configuration tasks

Snippets (prefixes)

- `create-backend`
- `create-local-db-index`
- `create-pass-through-authentication-handler`
- `dsconfig-command`
- `extension-argument-request-header`
- `extension-argument-client-secret`
- `set-password-policy-prop`
- `set-log-publisher-prop`
- `set-global-configuration-prop`
- `set-pass-through-authentication-handler-prop`
- `set-plugin-prop`
- `set-log-publisher-severity`

Usage

1. Open or create a `.dsconfig` file.
2. Start typing a subcommand or snippet prefix to see suggestions.

Development

- Open this folder in VS Code and press `F5` to launch an Extension Development Host.

Release

1. Use Conventional Commits (e.g. `feat: add snippet`, `fix: tweak grammar`).
2. Merge to `main` and Release Please will open a release PR.
3. Merge the release PR to create the GitHub release and tag.
4. The publish workflow packages the VSIX and publishes to the Marketplace.
5. Ensure `VSCE_PAT` is set as a GitHub Actions secret (Marketplace Manage scope).

Notes

- This initial release focuses on highlighting and snippets. LSP-based validation and IntelliSense can be added later.
- PingDirectory is a trademark of Ping Identity. This extension is not affiliated with or endorsed by Ping Identity.
