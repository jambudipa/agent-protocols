# bin

The executables that the package declares in `bin`. Today this is `a2a-db`, the command line for the SQL task and push notification stores.

## Boundary

- Belongs here: thin process entries that provide the Node platform layers and run a program.
- Does not belong here: command logic. The `a2a-db` commands live in `server/sql/Cli.ts`, where they are testable without a process.

## Constraints

- Each file starts with a `#!/usr/bin/env node` line and is listed in the `bin` field of `package.json`.
- An entry runs with error reporting off, so the command must print its own failure before it exits with status 1.
