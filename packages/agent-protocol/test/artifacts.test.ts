import { assert, layer } from "@effect/vitest"
import { Effect, FileSystem, Option, Path, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { AgentProtocolClient, ArtifactId, StepResult, TaskId } from "../src/index.js"
import type { TaskHandler } from "../src/index.js"
import { TestWorkspace, testServer } from "./support.js"

const echoHandler: TaskHandler = () => Effect.succeed(() => Effect.succeed(new StepResult({})))

const emptyTask = { input: Option.none(), additional_input: Option.none() }

const MessageBody = Schema.Struct({ message: Schema.String }).annotate({ identifier: "MessageBody" })

// Every byte value, so that a text or encoding round trip would show.
const content = Uint8Array.from({ length: 256 }, (_, index) => index)

const form = (fields: { readonly file?: { readonly name: string; readonly bytes: Uint8Array }; readonly relativePath?: string }) => {
  const data = new FormData()
  if (fields.file !== undefined) data.append("file", new Blob([fields.file.bytes]), fields.file.name)
  if (fields.relativePath !== undefined) data.append("relative_path", fields.relativePath)
  return data
}

layer(testServer(echoHandler), { excludeTestServices: true })("artifacts", (it) => {
  it.effect("uploads with relative_path, lists and downloads the same bytes", () =>
    Effect.gen(function*() {
      const client = yield* AgentProtocolClient
      const task = yield* client.createAgentTask({ payload: emptyTask })

      const artifact = yield* client.uploadAgentTaskArtifacts({
        params: { task_id: task.task_id },
        payload: form({ file: { name: "bytes.bin", bytes: content }, relativePath: "python/code" })
      })
      assert.strictEqual(artifact.file_name, "bytes.bin")
      assert.strictEqual(artifact.agent_created, false)
      assert.deepStrictEqual(artifact.relative_path, Option.some("python/code"))

      const downloaded = yield* client.downloadAgentTaskArtifact({
        params: { task_id: task.task_id, artifact_id: artifact.artifact_id }
      })
      assert.deepStrictEqual(new Uint8Array(downloaded), content)

      const listed = yield* client.listAgentTaskArtifacts({ params: { task_id: task.task_id }, query: {} })
      assert.deepStrictEqual(listed.artifacts, [artifact])
      assert.deepStrictEqual(listed.pagination, { total_items: 1, total_pages: 1, current_page: 1, page_size: 10 })
      assert.deepStrictEqual((yield* client.getAgentTask({ params: { task_id: task.task_id } })).artifacts, [artifact])

      // The file sits where the reference SDK puts it.
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const { directory } = yield* TestWorkspace
      const stored = yield* fs.readFile(path.join(directory, task.task_id, "python/code", "bytes.bin"))
      assert.deepStrictEqual(new Uint8Array(stored), content)
    }))

  it.effect("stores an upload without relative_path in the task directory", () =>
    Effect.gen(function*() {
      const client = yield* AgentProtocolClient
      const task = yield* client.createAgentTask({ payload: emptyTask })
      const artifact = yield* client.uploadAgentTaskArtifacts({
        params: { task_id: task.task_id },
        payload: form({ file: { name: "notes.txt", bytes: content } })
      })
      assert.deepStrictEqual(artifact.relative_path, Option.none())
      const downloaded = yield* client.downloadAgentTaskArtifact({
        params: { task_id: task.task_id, artifact_id: artifact.artifact_id }
      })
      assert.deepStrictEqual(new Uint8Array(downloaded), content)
    }))

  it.effect("keeps a file name that starts with two dots inside the task directory", () =>
    Effect.gen(function*() {
      const client = yield* AgentProtocolClient
      const task = yield* client.createAgentTask({ payload: emptyTask })
      const artifact = yield* client.uploadAgentTaskArtifacts({
        params: { task_id: task.task_id },
        payload: form({ file: { name: "..env", bytes: content }, relativePath: "..cache/data" })
      })
      assert.strictEqual(artifact.file_name, "..env")
      const downloaded = yield* client.downloadAgentTaskArtifact({
        params: { task_id: task.task_id, artifact_id: artifact.artifact_id }
      })
      assert.deepStrictEqual(new Uint8Array(downloaded), content)
    }))

  it.effect("rejects an upload without a file part with 422", () =>
    Effect.gen(function*() {
      const client = yield* AgentProtocolClient
      const http = yield* HttpClient.HttpClient
      const task = yield* client.createAgentTask({ payload: emptyTask })
      const response = yield* http.execute(
        HttpClientRequest.post(`/ap/v1/agent/tasks/${task.task_id}/artifacts`).pipe(
          HttpClientRequest.bodyFormData(form({ relativePath: "python/code" }))
        )
      )
      assert.strictEqual(response.status, 422)
      const body = yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(MessageBody)))
      assert.isTrue(body.message.length > 0)
    }))

  it.effect("rejects a relative_path that leaves the workspace with 422", () =>
    Effect.gen(function*() {
      const client = yield* AgentProtocolClient
      const http = yield* HttpClient.HttpClient
      const task = yield* client.createAgentTask({ payload: emptyTask })
      for (const relativePath of ["../escape", "/etc", "a/../../b"]) {
        const response = yield* http.execute(
          HttpClientRequest.post(`/ap/v1/agent/tasks/${task.task_id}/artifacts`).pipe(
            HttpClientRequest.bodyFormData(form({ file: { name: "x.txt", bytes: content }, relativePath }))
          )
        )
        assert.strictEqual(response.status, 422, relativePath)
      }
      const listed = yield* client.listAgentTaskArtifacts({ params: { task_id: task.task_id }, query: {} })
      assert.deepStrictEqual(listed.artifacts, [])
    }))

  it.effect("answers 404 for an upload to an unknown task and for an unknown artifact", () =>
    Effect.gen(function*() {
      const client = yield* AgentProtocolClient
      const task = yield* client.createAgentTask({ payload: emptyTask })
      const missing = yield* client.downloadAgentTaskArtifact({
        params: { task_id: task.task_id, artifact_id: ArtifactId.make("unknown") }
      }).pipe(Effect.flip)
      assert.strictEqual(missing._tag, "NotFound")
      const unknownTask = yield* client.uploadAgentTaskArtifacts({
        params: { task_id: TaskId.make("unknown") },
        payload: form({ file: { name: "x.txt", bytes: content } })
      }).pipe(Effect.flip)
      assert.strictEqual(unknownTask._tag, "NotFound")
    }))
})
