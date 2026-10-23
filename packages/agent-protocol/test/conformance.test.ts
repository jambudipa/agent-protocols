/**
 * Conformance with the vendored specification `spec/openapi.yml`.
 *
 * The server, the client and the OpenAPI document derive from the same
 * `AgentProtocolApi` value, so these checks cover the definition that serves
 * traffic.
 */
import { assert, layer } from "@effect/vitest"
import { Array as Arr, Effect, FileSystem, Option, Order, Path } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { OpenApi } from "effect/http-api"
import { AgentProtocolApi, StepResult } from "../src/index.js"
import type { TaskHandler } from "../src/index.js"
import { testServer } from "./support.js"

interface Operation {
  readonly method: string
  readonly path: string
  readonly operationId: string
}

const key = (operation: Operation) => `${operation.method.toUpperCase()} ${operation.path} ${operation.operationId}`

/**
 * Reads the operations of the vendored spec: each path at indent 2 under
 * `paths:`, each method at indent 4, and its `operationId` at indent 6.
 */
const specOperations = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = yield* path.fromFileUrl(new URL("../spec/openapi.yml", import.meta.url))
  const text = yield* fs.readFileString(file)
  const lines = text.slice(text.indexOf("\npaths:\n"), text.indexOf("\ncomponents:\n")).split("\n")
  const capture = (pattern: RegExp, line: string) =>
    Option.flatMap(Option.fromNullishOr(pattern.exec(line)), (match) => Option.fromUndefinedOr(match[1]))
  return lines.reduce<{ readonly path: string; readonly method: string; readonly operations: ReadonlyArray<Operation> }>(
    (state, line) =>
      Option.match(capture(/^ {2}'?(\/[^':]+)'?:$/, line), {
        onSome: (path) => ({ ...state, path }),
        onNone: () =>
          Option.match(capture(/^ {4}(get|post|put|patch|delete):$/, line), {
            onSome: (method) => ({ ...state, method }),
            onNone: () =>
              Option.match(capture(/^ {6}operationId: (\w+)$/, line), {
                onSome: (operationId) => ({
                  ...state,
                  operations: [...state.operations, { method: state.method, path: state.path, operationId }]
                }),
                onNone: () => state
              })
          })
      }),
    { path: "", method: "", operations: [] }
  ).operations
})

const generatedOperations = (): ReadonlyArray<Operation> =>
  Object.entries(OpenApi.fromApi(AgentProtocolApi).paths).flatMap(([path, item]) =>
    Object.entries(item).flatMap(([method, operation]) =>
      Option.match(Option.fromUndefinedOr((operation as { readonly operationId?: string }).operationId), {
        onNone: () => [],
        onSome: (operationId) => [{ method, path, operationId }]
      })
    )
  )

const echoHandler: TaskHandler = () => Effect.succeed(() => Effect.succeed(new StepResult({})))

const uploadForm = () => {
  const form = new FormData()
  form.append("file", new Blob(["conformance"]), "conformance.txt")
  return form
}

/** A well-formed request for each operation, so that a miss can only be a route miss. */
const requestFor = (operation: Operation, path: string): HttpClientRequest.HttpClientRequest => {
  const request = HttpClientRequest.make(operation.method.toUpperCase() as "GET" | "POST")(path)
  switch (operation.operationId) {
    case "createAgentTask":
    case "executeAgentTaskStep":
      return HttpClientRequest.bodyText(request, "{}", "application/json")
    case "uploadAgentTaskArtifacts":
      return HttpClientRequest.bodyFormData(request, uploadForm())
    default:
      return request
  }
}

layer(testServer(echoHandler), { excludeTestServices: true })("conformance", (it) => {
  it.effect("declares the operations of the spec, and no others", () =>
    Effect.gen(function*() {
      const spec = yield* specOperations
      assert.strictEqual(spec.length, 9)
      assert.deepStrictEqual(
        Arr.sort(generatedOperations().map(key), Order.String),
        Arr.sort(spec.map(key), Order.String)
      )
    }))

  it.effect("routes every spec path and method to a handler", () =>
    Effect.gen(function*() {
      const http = yield* HttpClient.HttpClient
      for (const operation of yield* specOperations) {
        const path = operation.path.replaceAll(/\{[^}]+\}/g, "unknown")
        const response = yield* http.execute(requestFor(operation, path))
        const body = yield* response.text
        // A route miss is an empty 404. A handler answers 2xx, or 404 with a message.
        assert.isFalse(response.status === 404 && body === "", `${operation.operationId} missed its route`)
        assert.isTrue(response.status === 200 || response.status === 404, `${operation.operationId}: ${response.status}`)
      }
    }))

  it.effect("answers an undeclared route with a route miss", () =>
    Effect.gen(function*() {
      const http = yield* HttpClient.HttpClient
      for (const request of [
        HttpClientRequest.get("/ap/v1/agent/unknown"),
        HttpClientRequest.delete("/ap/v1/agent/tasks"),
        HttpClientRequest.put("/ap/v1/agent/tasks/unknown")
      ]) {
        const response = yield* http.execute(request)
        assert.strictEqual(response.status, 404, request.url)
        assert.strictEqual(yield* response.text, "", request.url)
      }
    }))
})
