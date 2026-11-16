# client

The AG-UI client, exported as `@jambudipa/ag-ui/client`: `AgUiClient.run(input)` posts a `RunAgentInput` and returns the run as a decoded, chunk-expanded and verified `Stream` of events.

## Boundary

- Belongs here: the HTTP request, status handling, the choice of reader by the response `Content-Type`, and the composition `decode → expandChunks → verify`.
- Does not belong here: the readers and the operators themselves (`../Events.ts`, `../Verify.ts`), and protobuf code (`../proto/`, reached only through `AgUiProtoCodec`).

## Where to start

- `index.ts`: the export path.
- `AgUiClient.ts`: the service and its layer. `AgUiClient.layer({ url, headers?, encoding? })` needs an `HttpClient`; with `encoding: 'proto'` it also needs `AgUiProto.layer`.

## Constraints

- This folder must not import `@effect/platform-node` or `@bufbuild/protobuf`; `test/entrypoints.test.ts` proves it.
- The client holds no state between runs and reduces nothing: it yields events, not messages or state.
- Every failure is one of the tagged errors in `../Errors.ts`, so a caller can match on `_tag`.
