# agent-protocol internals

Server-side helpers that are not part of the public API: the in-memory task
store, the artifact workspace on disk, paging, and the path checks for uploads.

## Boundary

- Belongs here: state and file handling that `AgentProtocolServer.ts` needs,
  plus pure helpers that `Schemas.ts` uses inside schema filters.
- Does not belong here: wire schemas, errors or anything a caller of the
  package should see. The package exports nothing from this folder.

## Where to start

- `TaskStore.ts` holds all task, step and artifact records.
- `Workspace.ts` maps an artifact to its file under the workspace directory.

## Constraints

- Modules here import from the public modules (`Schemas.ts`, `Errors.ts`,
  `Handler.ts`), never the other way round, except the pure checks in
  `paths.ts` that `Schemas.ts` uses.
- Storage is in memory only, as in the reference SDK. There is no pluggable
  store.
- Behaviour mirrors the reference SDK: the workspace layout
  `<workspace>/<task_id>/<relative_path>/<file_name>` and the paging arithmetic
  must stay compatible with it.
