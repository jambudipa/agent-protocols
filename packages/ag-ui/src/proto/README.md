# proto

The protobuf binding of AG-UI 1.0, exported as `@jambudipa/ag-ui/proto`: the media type `application/vnd.ag-ui.event+proto`, in which each event is a 4-byte big-endian length followed by one `ag_ui.Event`.

## Boundary

- Belongs here: the converters between the JSON events and the protobuf messages, the length-prefixed framing, and `AgUiProto.layer`, which provides the `AgUiProtoCodec` service that the server and the client use.
- Does not belong here: HTTP code (the transports live in `server/` and `client/` and reach protobuf only through `AgUiProtoCodec`), and the generated code itself (`../generated/`).

## Where to start

- `index.ts`: the export path and `AgUiProto.layer`.
- `Proto.ts`: `encodeEvent` and `decodeEventBytes`, an Effect port of the converters in `@ag-ui/proto` 1.0.4. The converters reshape the event; protobuf-es `fromJson` and `toJson` encode only the leaves (`Value`, `Struct`, `int64`).
- `Framing.ts`: `encodeFrame` and `decodeFrames`, with the 10 MiB frame limit of the reference client.

## Constraints

- This is the only folder that imports `@bufbuild/protobuf`, an optional peer. Nothing outside it may import from it, except through `AgUiProtoCodec`.
- A decoded event goes through `decodeEvent`, the same tolerant decode as the SSE path, so both transports accept and reject the same events.
- The interop test in `test/proto.test.ts` round-trips every conformance event through `@ag-ui/proto`. Run it after any change to a converter.
