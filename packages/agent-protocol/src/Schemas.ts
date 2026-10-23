/**
 * Wire schemas for Agent Protocol v1.
 *
 * Each schema mirrors one component of the vendored specification
 * (`spec/openapi.yml`). Field names stay snake_case, as on the wire. A field
 * that the specification marks optional or nullable decodes to an `Option`:
 * a missing key and `null` both decode to `Option.none()`, and `Option.none()`
 * encodes to a missing key.
 *
 * @since 0.1.0
 */
import { Schema } from 'effect';
import { Multipart } from 'effect/http';
import { HttpApiSchema } from 'effect/http-api';
import { isUsableFileName, isWorkspaceRelative } from './internal/paths.js';

/**
 * The ID of a task.
 *
 * @since 0.1.0
 */
export const TaskId = Schema.String.pipe(Schema.brand('TaskId')).annotate({
  identifier: 'TaskId',
  description: 'The ID of the task.',
});

/**
 * @since 0.1.0
 */
export type TaskId = typeof TaskId.Type;

/**
 * The ID of a task step.
 *
 * @since 0.1.0
 */
export const StepId = Schema.String.pipe(Schema.brand('StepId')).annotate({
  identifier: 'StepId',
  description: 'The ID of the task step.',
});

/**
 * @since 0.1.0
 */
export type StepId = typeof StepId.Type;

/**
 * The ID of an artifact.
 *
 * @since 0.1.0
 */
export const ArtifactId = Schema.String.pipe(
  Schema.brand('ArtifactId')
).annotate({
  identifier: 'ArtifactId',
  description: 'ID of the artifact.',
});

/**
 * @since 0.1.0
 */
export type ArtifactId = typeof ArtifactId.Type;

/**
 * Paging metadata for a list response.
 *
 * @since 0.1.0
 */
export const Pagination = Schema.Struct({
  total_items: Schema.Int.annotate({ description: 'Total number of items.' }),
  total_pages: Schema.Int.annotate({ description: 'Total number of pages.' }),
  current_page: Schema.Int.annotate({
    description: 'Current_page page number.',
  }),
  page_size: Schema.Int.annotate({ description: 'Number of items per page.' }),
}).annotate({ identifier: 'Pagination' });

/**
 * @since 0.1.0
 */
export type Pagination = typeof Pagination.Type;

const PageNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/**
 * The paging query parameters of a list operation. Both are optional and must
 * be at least 1. The server reads a missing `current_page` as 1 and a missing
 * `page_size` as 10.
 *
 * @since 0.1.0
 */
export const PaginationQuery = Schema.Struct({
  current_page: Schema.optionalKey(
    PageNumber.annotate({ description: 'Page number', default: 1 })
  ),
  page_size: Schema.optionalKey(
    PageNumber.annotate({
      description: 'Number of items per page',
      default: 10,
    })
  ),
}).annotate({ identifier: 'PaginationQuery' });

/**
 * @since 0.1.0
 */
export type PaginationQuery = typeof PaginationQuery.Type;

/**
 * Input parameters for the task. Any JSON object is allowed.
 *
 * @since 0.1.0
 */
export const TaskInput = Schema.JsonObject.annotate({
  identifier: 'TaskInput',
  description: 'Input parameters for the task. Any value is allowed.',
});

/**
 * Input parameters for the task step. Any JSON object is allowed.
 *
 * @since 0.1.0
 */
export const StepInput = Schema.JsonObject.annotate({
  identifier: 'StepInput',
  description: 'Input parameters for the task step. Any value is allowed.',
});

/**
 * Output that the task step has produced. Any JSON object is allowed.
 *
 * @since 0.1.0
 */
export const StepOutput = Schema.JsonObject.annotate({
  identifier: 'StepOutput',
  description: 'Output that the task step has produced. Any value is allowed.',
});

/**
 * An artifact either created by or submitted to the agent.
 *
 * @since 0.1.0
 */
export const Artifact = Schema.Struct({
  artifact_id: ArtifactId,
  agent_created: Schema.Boolean.annotate({
    description: 'Whether the artifact has been created by the agent.',
  }),
  file_name: Schema.String.annotate({
    description: 'Filename of the artifact.',
  }),
  relative_path: Schema.OptionFromOptionalNullOr(Schema.String).annotate({
    description: "Relative path of the artifact in the agent's workspace.",
  }),
}).annotate({
  identifier: 'Artifact',
  description: 'An Artifact either created by or submitted to the agent.',
});

/**
 * @since 0.1.0
 */
export type Artifact = typeof Artifact.Type;

/**
 * The body of a create task request.
 *
 * @since 0.1.0
 */
export const TaskRequestBody = Schema.Struct({
  input: Schema.OptionFromOptionalNullOr(Schema.String).annotate({
    description: 'Input prompt for the task.',
  }),
  additional_input: Schema.OptionFromOptionalNullOr(TaskInput),
}).annotate({
  identifier: 'TaskRequestBody',
  description: 'Body of the task request.',
});

/**
 * @since 0.1.0
 */
export type TaskRequestBody = typeof TaskRequestBody.Type;

/**
 * An agent task.
 *
 * @since 0.1.0
 */
export const Task = Schema.Struct({
  ...TaskRequestBody.fields,
  task_id: TaskId,
  artifacts: Schema.Array(Artifact).annotate({
    description: 'A list of artifacts that the task has produced.',
  }),
}).annotate({
  identifier: 'Task',
  description: 'Definition of an agent task.',
});

/**
 * @since 0.1.0
 */
export type Task = typeof Task.Type;

/**
 * The body of an execute step request.
 *
 * @since 0.1.0
 */
export const StepRequestBody = Schema.Struct({
  input: Schema.OptionFromOptionalNullOr(Schema.String).annotate({
    description: 'Input prompt for the step.',
  }),
  additional_input: Schema.OptionFromOptionalNullOr(StepInput),
}).annotate({
  identifier: 'StepRequestBody',
  description: 'Body of the task request.',
});

/**
 * @since 0.1.0
 */
export type StepRequestBody = typeof StepRequestBody.Type;

/**
 * The status of a task step.
 *
 * @since 0.1.0
 */
export const StepStatus = Schema.Literals([
  'created',
  'running',
  'completed',
]).annotate({
  identifier: 'StepStatus',
  description: 'The status of the task step.',
});

/**
 * @since 0.1.0
 */
export type StepStatus = typeof StepStatus.Type;

/**
 * A step of an agent task.
 *
 * @since 0.1.0
 */
export const Step = Schema.Struct({
  ...StepRequestBody.fields,
  task_id: TaskId,
  step_id: StepId,
  name: Schema.OptionFromOptionalNullOr(Schema.String).annotate({
    description: 'The name of the task step.',
  }),
  status: StepStatus,
  output: Schema.OptionFromOptionalNullOr(Schema.String).annotate({
    description: 'Output of the task step.',
  }),
  additional_output: Schema.OptionFromOptionalNullOr(StepOutput),
  artifacts: Schema.Array(Artifact).annotate({
    description: 'A list of artifacts that the step has produced.',
  }),
  is_last: Schema.Boolean.annotate({
    description: 'Whether this is the last step in the task.',
  }),
}).annotate({ identifier: 'Step' });

/**
 * @since 0.1.0
 */
export type Step = typeof Step.Type;

/**
 * One page of tasks.
 *
 * @since 0.1.0
 */
export const TaskListResponse = Schema.Struct({
  tasks: Schema.Array(Task),
  pagination: Pagination,
}).annotate({ identifier: 'TaskListResponse' });

/**
 * @since 0.1.0
 */
export type TaskListResponse = typeof TaskListResponse.Type;

/**
 * One page of the steps of a task.
 *
 * @since 0.1.0
 */
export const TaskStepsListResponse = Schema.Struct({
  steps: Schema.Array(Step),
  pagination: Pagination,
}).annotate({ identifier: 'TaskStepsListResponse' });

/**
 * @since 0.1.0
 */
export type TaskStepsListResponse = typeof TaskStepsListResponse.Type;

/**
 * One page of the artifacts of a task.
 *
 * @since 0.1.0
 */
export const TaskArtifactsListResponse = Schema.Struct({
  artifacts: Schema.Array(Artifact),
  pagination: Pagination,
}).annotate({ identifier: 'TaskArtifactsListResponse' });

/**
 * @since 0.1.0
 */
export type TaskArtifactsListResponse = typeof TaskArtifactsListResponse.Type;

/**
 * A relative path inside the task directory of the workspace. An absolute path
 * or a `..` segment fails to decode, so an upload cannot escape the workspace.
 *
 * @since 0.1.0
 */
export const RelativePath = Schema.String.check(
  Schema.makeFilter(isWorkspaceRelative, {
    expected: "a relative path without '..' segments",
  })
).annotate({
  identifier: 'RelativePath',
  description: "Relative path of the artifact in the agent's workspace.",
});

const hasUsableFileName = (file: Multipart.PersistedFile): boolean =>
  isUsableFileName(file.name);

/**
 * The multipart body of an artifact upload: exactly one `file` part and an
 * optional `relative_path` field.
 *
 * @since 0.1.0
 */
export const ArtifactUpload = Schema.Struct({
  file: Multipart.SingleFileSchema.check(
    Schema.makeFilter(hasUsableFileName, {
      expected: 'a file with a file name',
    })
  ).annotate({ description: 'File to upload.' }),
  relative_path: Schema.OptionFromOptionalKey(RelativePath),
})
  .annotate({
    identifier: 'ArtifactUpload',
    description: 'Artifact to upload to the agent.',
  })
  .pipe(HttpApiSchema.asMultipart());

/**
 * @since 0.1.0
 */
export type ArtifactUpload = typeof ArtifactUpload.Type;

/**
 * The bytes of a downloaded artifact.
 *
 * @since 0.1.0
 */
export const ArtifactContent = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array()
);
