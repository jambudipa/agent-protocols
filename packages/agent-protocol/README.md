# @agent-protocols/agent-protocol

[Agent Protocol v1](https://github.com/AI-Engineer-Foundation/agent-protocol)
for Effect v4: a server, a typed client and the OpenAPI document, all derived
from one `HttpApi` definition.

It keeps feature parity with npm `agent-protocol` 1.0.5: you supply a task
handler that returns a step handler, tasks live in memory, and artifacts live
in a workspace directory. It adds a typed client, which the reference SDK does
not have.

## Install

```sh
npm install @agent-protocols/agent-protocol effect@~4.0.6 @effect/platform-node@~4.0.6
```

`effect` and `@effect/platform-node` are peer dependencies.

## Serve an agent

```ts
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Option, Ref } from "effect"
import { StepResult, type TaskHandler } from "@agent-protocols/agent-protocol"
import * as AgentProtocolNode from "@agent-protocols/agent-protocol/node"

// Runs once for each new task, and returns the step handler of that task.
const taskHandler: TaskHandler = Effect.fnUntraced(function*(task) {
  const steps = yield* Ref.make(0)
  // Runs once for each step. `input` is `Option.none()` for a step without a body.
  return (input) =>
    Ref.updateAndGet(steps, (n) => n + 1).pipe(
      Effect.map((n) =>
        new StepResult({
          name: Option.some(`step ${n}`),
          output: Option.some(`task ${task.task_id}, step ${n}`),
          is_last: n === 3
        })
      )
    )
})

Layer.launch(AgentProtocolNode.layer(taskHandler, { port: 8000, workspace: "./workspace" })).pipe(
  NodeRuntime.runMain
)
```

The defaults are port 8000 and workspace `./workspace`, as in the reference SDK.
The generated OpenAPI document is at `GET /openapi.json`.

To serve on another platform, provide `AgentProtocolServer.layer(taskHandler, { workspace })`
to `HttpRouter.serve` with that platform's HTTP server layer.

### Handler contract

```ts
type TaskHandler = (task: Task) => Effect.Effect<StepHandler, TaskFailed>
type StepHandler = (input: Option.Option<StepRequestBody>) => Effect.Effect<StepResult, StepFailed>
```

- A `TaskFailed` from the task handler answers 500, and the server stores no task.
- A `StepFailed` from the step handler answers 500, and the server stores no step.
  The task stays readable.
- Each step has status `completed`. The artifacts of a step are added to its task.
- An artifact in `StepResult.artifacts` is metadata. As in the reference SDK, the
  agent writes the file itself, at `<workspace>/<task_id>/<relative_path>/<file_name>`.

## Call an agent

```ts
import { FetchHttpClient } from "effect/http"
import { Effect, Layer, Option } from "effect"
import { AgentProtocolClient } from "@agent-protocols/agent-protocol"

const program = Effect.gen(function*() {
  const client = yield* AgentProtocolClient
  const task = yield* client.createAgentTask({
    payload: { input: Option.some("Write 'Washington' to output.txt"), additional_input: Option.none() }
  })
  const step = yield* client.executeAgentTaskStep({
    params: { task_id: task.task_id },
    payload: { input: Option.none(), additional_input: Option.none() }
  })
  return step.output
}).pipe(
  Effect.provide(
    AgentProtocolClient.layer({ baseUrl: "http://localhost:8000" }).pipe(Layer.provide(FetchHttpClient.layer))
  )
)
```

Each client method is named after its `operationId` in the specification. Upload
an artifact with a `FormData` payload that has a `file` part and an optional
`relative_path` field.

## Wire format

- Field names are snake_case, as in the specification.
- An optional or nullable field decodes to an `Option`. A missing key and `null`
  both decode to `Option.none()`, and `Option.none()` encodes to a missing key.
- List operations take `current_page` and `page_size` (default 1 and 10, each at
  least 1).
- An unknown task, step or artifact answers 404 with `{ "message": ... }`.
- A request whose path, query or body does not decode answers 422 with
  `{ "message": ... }`. This includes an upload without a `file` part, and a
  `relative_path` that is absolute or has a `..` segment.

## Conformance

`spec/openapi.yml` is the specification at commit
`5047199152dc6e1ba83320b1b59f94af24046dcf`. The conformance test checks that the
generated OpenAPI document declares the same paths, methods and `operationId`
values, and that a running server routes each of them to a handler.
