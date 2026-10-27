/**
 * The Agent Protocol v1 HTTP API, defined once.
 *
 * The server, the typed client and the OpenAPI document all derive from
 * `AgentProtocolApi`. Each endpoint identifier is the `operationId` of the
 * specification, and the group is top level, so the OpenAPI document and the
 * client both use the bare `operationId`.
 *
 * @since 0.1.0
 */
import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  OpenApi,
} from 'effect/http-api';
import { NotFoundResponse, UnprocessableEntityResponse } from './Errors.js';
import {
  Artifact,
  ArtifactContent,
  ArtifactId,
  ArtifactUpload,
  PaginationQuery,
  Step,
  StepId,
  StepRequestBody,
  Task,
  TaskArtifactsListResponse,
  TaskId,
  TaskListResponse,
  TaskRequestBody,
  TaskStepsListResponse,
} from './Schemas.js';

/**
 * Turns every request decode failure into status 422 with a JSON body. The
 * server provides the implementation; a client does not need one.
 *
 * @since 0.1.0
 */
export class RequestDecodeErrors extends HttpApiMiddleware.Service<RequestDecodeErrors>()(
  '@jambudipa/agent-protocol/Api/RequestDecodeErrors'
) {}

/** The path parameter that every per-task endpoint shares. */
const TaskParams = { task_id: TaskId };

/**
 * The 500 response of the endpoints that run agent code or touch the
 * workspace. It has no body, so no failure detail leaks to the client.
 */
const InternalServerError = HttpApiError.InternalServerErrorNoContent;

/**
 * The `agent` group: the nine operations of the specification.
 *
 * @since 0.1.0
 */
export class AgentGroup extends HttpApiGroup.make('agent', { topLevel: true })
  .add(
    HttpApiEndpoint.post('createAgentTask', '/agent/tasks', {
      // A missing body decodes as `null`, which the server reads as no input.
      payload: [TaskRequestBody, Schema.Null],
      success: Task,
      error: [UnprocessableEntityResponse, InternalServerError],
    }).annotate(OpenApi.Summary, 'Creates a task for the agent.'),
    HttpApiEndpoint.get('listAgentTasks', '/agent/tasks', {
      query: PaginationQuery,
      success: TaskListResponse,
    }).annotate(
      OpenApi.Summary,
      'List all tasks that have been created for the agent.'
    ),
    HttpApiEndpoint.get('getAgentTask', '/agent/tasks/:task_id', {
      params: TaskParams,
      success: Task,
      error: NotFoundResponse,
    }).annotate(OpenApi.Summary, 'Get details about a specified agent task.'),
    HttpApiEndpoint.get('listAgentTaskSteps', '/agent/tasks/:task_id/steps', {
      params: TaskParams,
      query: PaginationQuery,
      success: TaskStepsListResponse,
      error: NotFoundResponse,
    }).annotate(OpenApi.Summary, 'List all steps for the specified task.'),
    HttpApiEndpoint.post(
      'executeAgentTaskStep',
      '/agent/tasks/:task_id/steps',
      {
        params: TaskParams,
        // A missing body decodes as `null`; the step handler gets `Option.none()`.
        payload: [StepRequestBody, Schema.Null],
        success: Step,
        error: [
          NotFoundResponse,
          UnprocessableEntityResponse,
          InternalServerError,
        ],
      }
    ).annotate(OpenApi.Summary, 'Execute a step in the specified agent task.'),
    HttpApiEndpoint.get(
      'getAgentTaskStep',
      '/agent/tasks/:task_id/steps/:step_id',
      {
        params: { ...TaskParams, step_id: StepId },
        success: Step,
        error: NotFoundResponse,
      }
    ).annotate(OpenApi.Summary, 'Get details about a specified task step.'),
    HttpApiEndpoint.get(
      'listAgentTaskArtifacts',
      '/agent/tasks/:task_id/artifacts',
      {
        params: TaskParams,
        query: PaginationQuery,
        success: TaskArtifactsListResponse,
        error: NotFoundResponse,
      }
    ).annotate(
      OpenApi.Summary,
      'List all artifacts that have been created for the given task.'
    ),
    HttpApiEndpoint.post(
      'uploadAgentTaskArtifacts',
      '/agent/tasks/:task_id/artifacts',
      {
        params: TaskParams,
        payload: ArtifactUpload,
        success: Artifact,
        error: [NotFoundResponse, InternalServerError],
      }
    ).annotate(OpenApi.Summary, 'Upload an artifact for the specified task.'),
    HttpApiEndpoint.get(
      'downloadAgentTaskArtifact',
      '/agent/tasks/:task_id/artifacts/:artifact_id',
      {
        params: { ...TaskParams, artifact_id: ArtifactId },
        success: ArtifactContent,
        error: [NotFoundResponse, InternalServerError],
      }
    ).annotate(OpenApi.Summary, 'Download a specified artifact.')
  )
  .prefix('/ap/v1') {}

/**
 * The Agent Protocol v1 API.
 *
 * @since 0.1.0
 */
export class AgentProtocolApi extends HttpApi.make('agent-protocol')
  .add(AgentGroup)
  .middleware(RequestDecodeErrors)
  .annotateMerge(
    OpenApi.annotations({
      title: 'Agent Protocol',
      description:
        'Specification of the API protocol for communication with an agent.',
      version: 'v1',
    })
  ) {}
