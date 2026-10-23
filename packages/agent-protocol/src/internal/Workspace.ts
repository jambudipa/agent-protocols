/**
 * Artifact files in the workspace directory.
 *
 * The layout matches the reference SDK: the file of an artifact lives at
 * `<workspace>/<task_id>/<relative_path>/<file_name>`.
 */
import { Effect, FileSystem, Option, Path } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import type { Artifact, TaskId } from '../Schemas.js';

/** The file operations of the workspace. */
export interface Workspace {
  /** Copies an uploaded file to the place of `artifact`. */
  readonly store: (
    taskId: TaskId,
    artifact: Artifact,
    source: string
  ) => Effect.Effect<void, PlatformError>;
  /**
   * Reads the file of `artifact`. `Option.none()` means that the artifact names
   * a place outside the task directory.
   */
  readonly read: (
    taskId: TaskId,
    artifact: Artifact
  ) => Effect.Effect<Option.Option<Uint8Array>, PlatformError>;
}

/** Creates the workspace at `root`, resolved against the working directory. */
export const makeWorkspace = Effect.fnUntraced(function* (
  root: string
): Effect.fn.Return<Workspace, never, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspace = path.resolve(root);

  // An artifact that a step handler returns did not pass the upload schema,
  // so check that its place stays inside the task directory.
  const locate = (
    taskId: TaskId,
    artifact: Artifact
  ): Option.Option<string> => {
    const taskDirectory = path.join(workspace, taskId);
    const file = path.join(
      taskDirectory,
      Option.getOrElse(artifact.relative_path, () => ''),
      artifact.file_name
    );
    const relative = path.relative(taskDirectory, file);
    // A name such as `..env` stays inside; only a `..` segment leaves.
    const leaves =
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative);
    return relative === '' || leaves ? Option.none() : Option.some(file);
  };

  return {
    store: (taskId, artifact, source) =>
      Option.match(locate(taskId, artifact), {
        // The upload schema rejects any path that leaves the task directory.
        onNone: () =>
          Effect.die(
            new Error(
              `Artifact ${artifact.artifact_id} is outside the task directory`
            )
          ),
        onSome: (file) =>
          fs
            .makeDirectory(path.dirname(file), { recursive: true })
            .pipe(Effect.andThen(fs.copyFile(source, file))),
      }),
    read: (taskId, artifact) =>
      Option.match(locate(taskId, artifact), {
        onNone: () => Effect.succeedNone,
        onSome: (file) => Effect.map(fs.readFile(file), Option.some),
      }),
  };
});
