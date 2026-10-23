/**
 * Test support: a real Agent Protocol server on an ephemeral port, a temporary
 * workspace directory, and the typed client pointed at the server.
 */
import { NodeCrypto, NodeHttpServer } from '@effect/platform-node';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { AgentProtocolClient, AgentProtocolServer } from '../src/index.js';
import type { TaskHandler } from '../src/index.js';

/** The temporary workspace directory of the server under test. */
export class TestWorkspace extends Context.Service<
  TestWorkspace,
  { readonly directory: string }
>()('@agent-protocols/agent-protocol/test/TestWorkspace') {
  static readonly layer = Layer.effect(
    TestWorkspace,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: 'agent-protocol-',
      });
      return TestWorkspace.of({ directory });
    })
  );
}

const serve = (taskHandler: TaskHandler) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { directory } = yield* TestWorkspace;
      return HttpRouter.serve(
        AgentProtocolServer.layer(taskHandler, { workspace: directory }),
        {
          disableLogger: true,
        }
      );
    })
  );

/**
 * Serves `taskHandler` and provides the typed client, the raw `HttpClient`
 * (with the server URL prepended), the file system and the workspace.
 */
export const testServer = (taskHandler: TaskHandler) =>
  AgentProtocolClient.layer().pipe(
    Layer.provideMerge(serve(taskHandler)),
    Layer.provideMerge(TestWorkspace.layer),
    Layer.provideMerge(NodeHttpServer.layerTest),
    Layer.provideMerge(NodeCrypto.layer)
  );
