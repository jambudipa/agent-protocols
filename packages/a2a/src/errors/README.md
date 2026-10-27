# errors

The A2A errors of the specification and their mappings to the JSON-RPC and HTTP+JSON bindings. This folder is the `./errors` export path.

## Boundary

- Belongs here: the error classes, the tables of JSON-RPC codes, HTTP statuses and `ErrorInfo` reasons, and the conversions between errors and their wire forms.
- Does not belong here: gRPC code. The gRPC mapping lives in `grpc/`, so that importing `./errors` loads no protobuf code.

## Entry points

- `index.ts`: start with `A2A_ERROR_SPECS`, the one table that gives each error its reason, codes, statuses and default message.

## Constraints

- The values follow `@a2a-js/sdk` 1.3.0, so that the interop tests pass in both directions.
- A new error class needs an entry in the `A2AError` union, in `A2A_ERROR_SPECS` and in the private `A2AErrorTags` list. The compiler checks the first two but not the third.
