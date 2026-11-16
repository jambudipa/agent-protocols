# internal

Private helpers of the common entry point. Nothing here is exported from the package.

## Boundary

- Belongs here: small helpers that `Events.ts` and the protobuf binding share, and that import only `effect`.
- Does not belong here: anything that the server or the client alone uses (put it in `server/` or `client/`), and anything that imports an optional peer dependency.

## Where to start

- `tolerance.ts`: the pass that strips unknown union members (a message role, a content part, a JSON Patch `op`, an `outcome`) from raw JSON before a schema decodes it.
- `issues.ts`: renders a schema failure as a JSON array of `"<pointer>: expected X, received Y"` lines, in the reference client's wording.

## Constraints

- `tolerance.ts` must never touch a wrong-typed value: a malformed known field stays fatal. It removes only a member whose tag the schema does not know.
- The wording of `issues.ts` is matched by the conformance fixtures' `errorContains`. Run the conformance test after any change.
