# compat/v0_3/server

The server side of the A2A protocol 0.3 compatibility layer. It lets a v1.0
agent answer v0.3 clients over JSON-RPC, HTTP+JSON and push notification
webhooks, with the wire behaviour of `@a2a-js/sdk` 1.3.0.

## Boundary

- Belongs here: the v0.3 bindings themselves. Each one decodes the v0.3
  request, translates it, calls the v1.0 `A2ARequestHandler`, and encodes
  the result back to v0.3.
- Does not belong here: the translation between v0.3 and v1.0 types (in
  `../translate.ts` and `../proto.ts`), the v0.3 schemas, and any agent logic.
  This folder holds no state and makes no decision of its own.
- gRPC lives in `grpc/`, so the default entry point loads no gRPC or protobuf
  code. Keep it that way: nothing outside `grpc/` may import `@grpc/grpc-js`
  or `@bufbuild/protobuf`.

## Entry points

- `index.ts` exports `legacyCompat`, the object that the v1.0 HTTP bindings
  take to enable v0.3. Start here.
- `JsonRpc.ts` and `Rest.ts` hold the two HTTP bindings.
- `PushNotification.ts` holds the v0.3 webhook serializer.

## Constraints

- Every failure leaves through `toLegacyErrorBody`, so a v0.3 client never
  sees a v1.0 error shape. HTTP+JSON also maps the status with
  `legacyHttpStatusFor`.
- Error text, status codes and capability checks copy the reference SDK on
  purpose. Change one only to match the reference.
- The Agent Card must declare interfaces with protocol version 0.3, or every
  v0.3 request fails the version check.
