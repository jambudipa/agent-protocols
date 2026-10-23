/**
 * The Agent Protocol server: the handlers of `AgentProtocolApi`, an in-memory
 * task store, and artifact files in a workspace directory.
 *
 * `layer` registers the routes with an `HttpRouter`. Serve it with
 * `HttpRouter.serve` on any platform, or use `@agent-protocols/agent-protocol/node`
 * for a ready Node server.
 *
 * @since 0.1.0
 */
import { Crypto, Effect, Layer, Option } from "effect"
import type { Cause } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiError, HttpApiMiddleware } from "effect/http-api"
import { AgentProtocolApi, RequestDecodeErrors } from "./Api.js"
import { NotFound, UnprocessableEntity, UnprocessableEntityResponse } from "./Errors.js"
import type { TaskHandler } from "./Handler.js"
import { fileNameOf } from "./internal/paths.js"
import { page } from "./internal/paging.js"
import { makeTaskStore } from "./internal/TaskStore.js"
import { makeWorkspace } from "./internal/Workspace.js"
import { ArtifactId, StepId, TaskId } from "./Schemas.js"
import type { Artifact, Step, Task } from "./Schemas.js"

/**
 * Options of the server.
 *
 * @since 0.1.0
 */
export interface Options {
  /**
   * The directory that holds the artifact files, resolved against the working
   * directory. The default is `./workspace`, as in the reference SDK.
   */
  readonly workspace?: string
}

/**
 * The default workspace directory.
 *
 * @since 0.1.0
 */
export const defaultWorkspace = "./workspace"

const writeUnprocessableEntity = HttpServerResponse.schemaJson(UnprocessableEntityResponse)

/**
 * The server side of `RequestDecodeErrors`: a request whose path, query or body
 * does not decode gets status 422 and the body `{ "message": ... }`. A response
 * that does not encode stays a 500.
 *
 * @since 0.1.0
 */
export const requestDecodeErrorsLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  RequestDecodeErrors,
  (error) =>
    error.kind === "Body" || error.kind === "ResponseHeaders"
      ? Effect.fail(error)
      : writeUnprocessableEntity(
        new UnprocessableEntity({ message: `Invalid request ${error.kind.toLowerCase()}: ${error.cause.message}` }),
        { status: 422 }
      ).pipe(
        // The body is a fixed struct of strings, so encoding it cannot fail.
        Effect.orDie
      )
)

const internalServerError = (message: string) => (cause: Cause.YieldableError) =>
  Effect.logError(message, cause).pipe(Effect.andThen(Effect.fail(new HttpApiError.InternalServerError())))

const handlers = (taskHandler: TaskHandler, options: Options) =>
  HttpApiBuilder.group(
    AgentProtocolApi,
    "agent",
    Effect.fn("AgentProtocolServer.handlers")(function*(handlers) {
      const crypto = yield* Crypto.Crypto
      const store = yield* makeTaskStore
      const workspace = yield* makeWorkspace(options.workspace ?? defaultWorkspace)
      const uuid = crypto.randomUUIDv4().pipe(Effect.catch(internalServerError("Unable to generate an id")))

      return handlers.handleAll({
        createAgentTask: Effect.fn("AgentProtocolServer.createAgentTask")(function*({ payload }) {
          const body = Option.fromNullishOr(payload)
          const task: Task = {
            task_id: TaskId.make(yield* uuid),
            input: Option.flatMap(body, (request) => request.input),
            additional_input: Option.flatMap(body, (request) => request.additional_input),
            artifacts: []
          }
          const stepHandler = yield* taskHandler(task).pipe(
            Effect.catch(internalServerError("The task handler failed"))
          )
          yield* store.add(task, stepHandler)
          return task
        }),

        listAgentTasks: Effect.fn("AgentProtocolServer.listAgentTasks")(function*({ query }) {
          const { items, pagination } = page(yield* store.tasks, query)
          return { tasks: items, pagination }
        }),

        getAgentTask: Effect.fn("AgentProtocolServer.getAgentTask")(function*({ params }) {
          const entry = yield* store.require(params.task_id)
          return entry.task
        }),

        listAgentTaskSteps: Effect.fn("AgentProtocolServer.listAgentTaskSteps")(function*({ params, query }) {
          const entry = yield* store.require(params.task_id)
          const { items, pagination } = page(Array.from(entry.steps), query)
          return { steps: items, pagination }
        }),

        executeAgentTaskStep: Effect.fn("AgentProtocolServer.executeAgentTaskStep")(function*({ params, payload }) {
          const entry = yield* store.require(params.task_id)
          const body = Option.fromNullishOr(payload)
          const result = yield* entry.stepHandler(body).pipe(
            Effect.catch(internalServerError("The step handler failed"))
          )
          const step: Step = {
            task_id: params.task_id,
            step_id: StepId.make(yield* uuid),
            input: Option.flatMap(body, (request) => request.input),
            additional_input: Option.flatMap(body, (request) => request.additional_input),
            name: result.name,
            status: "completed",
            output: result.output,
            additional_output: result.additional_output,
            artifacts: result.artifacts,
            is_last: result.is_last
          }
          // The step is stored only after the handler succeeds, so a failed
          // step leaves no partial record behind.
          yield* store.appendStep(step)
          return step
        }),

        getAgentTaskStep: ({ params }) => store.requireStep(params.task_id, params.step_id),

        listAgentTaskArtifacts: Effect.fn("AgentProtocolServer.listAgentTaskArtifacts")(function*({ params, query }) {
          const entry = yield* store.require(params.task_id)
          const { items, pagination } = page(entry.task.artifacts, query)
          return { artifacts: items, pagination }
        }),

        uploadAgentTaskArtifacts: Effect.fn("AgentProtocolServer.uploadAgentTaskArtifacts")(function*({ params, payload }) {
          yield* store.require(params.task_id)
          const artifact: Artifact = {
            artifact_id: ArtifactId.make(yield* uuid),
            agent_created: false,
            file_name: fileNameOf(payload.file.name),
            relative_path: payload.relative_path
          }
          yield* workspace.store(params.task_id, artifact, payload.file.path).pipe(
            Effect.catch(internalServerError("Unable to store the artifact"))
          )
          yield* store.addArtifact(params.task_id, artifact)
          return artifact
        }),

        downloadAgentTaskArtifact: Effect.fn("AgentProtocolServer.downloadAgentTaskArtifact")(function*({ params }) {
          const artifact = yield* store.requireArtifact(params.task_id, params.artifact_id)
          const missing = () =>
            Effect.fail(new NotFound({ message: `The file of artifact ${artifact.artifact_id} does not exist` }))
          const content = yield* workspace.read(params.task_id, artifact).pipe(
            Effect.catchIf(
              (error) => error.reason._tag === "NotFound",
              () => Effect.succeedNone
            ),
            Effect.catch(internalServerError("Unable to read the artifact"))
          )
          return yield* Option.match(content, { onNone: missing, onSome: Effect.succeed })
        })
      })
    })
  )

/**
 * The routes of the Agent Protocol, served by the given task handler. The
 * OpenAPI document of the API is at `GET /openapi.json`.
 *
 * @since 0.1.0
 */
export const layer = (taskHandler: TaskHandler, options: Options = {}) =>
  HttpApiBuilder.layer(AgentProtocolApi, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(handlers(taskHandler, options).pipe(Layer.provide(requestDecodeErrorsLayer)))
  )
