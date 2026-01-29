# PingDirectory dsconfig VS Code Extension

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

Notes
- This initial release focuses on highlighting and snippets. LSP-based validation and IntelliSense can be added later.
