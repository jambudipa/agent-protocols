# spec

The AG-UI 1.0 sources that this package implements, vendored unchanged from
[`ag-ui-protocol/ag-ui`](https://github.com/ag-ui-protocol/ag-ui) at the tag
`@ag-ui/core@1.0.4`, commit `d540f5934429bd548ba9c53da286028958e7506a`.

| Path | Upstream path | Use |
| --- | --- | --- |
| `1.0/schema.json` | `spec/1.0/schema.json` | The JSON Schema that the Effect Schemas in `src/` follow. |
| `1.0/conformance/streams/` | `spec/1.0/conformance/streams/` | The shared conformance fixtures that the tests replay through `verify`. |
| `proto/*.proto` | `sdks/typescript/packages/proto/src/proto/` | The protobuf messages (`package ag_ui`) that `npm run generate` compiles. |
| `LICENSE` | `LICENSE` | The MIT licence of the upstream repository. |

Do not edit these files. To move to a new AG-UI release, copy the same paths
from the new tag, run `npm run generate -w @jambudipa/ag-ui`, and update the
commit above.
