/**
 * Failures of the Agent Protocol server and of the agent's handlers.
 *
 * `NotFound` and `UnprocessableEntity` cross the wire. Their wire codecs
 * (`NotFoundResponse`, `UnprocessableEntityResponse`) encode the body as
 * `{ "message": ... }`, the shape that the specification defines, so the
 * Effect error tag stays out of the protocol.
 *
 * @since 0.1.0
 */
import { Schema, SchemaTransformation } from 'effect';
import { HttpApiSchema } from 'effect/http-api';

/**
 * The `{ "message": ... }` body that the specification defines for every error
 * response. The wire codecs map the tagged errors to and from this shape.
 */
const MessageBody = Schema.Struct({
  message: Schema.String.annotate({
    description: 'Message stating the problem',
  }),
}).annotate({ identifier: 'MessageBody' });

/**
 * The task, step or artifact with the given identifier does not exist.
 *
 * @since 0.1.0
 */
export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', {
  message: Schema.String,
}) {}

/**
 * The wire codec of `NotFound`: status 404 with body `{ "message": ... }`.
 *
 * @since 0.1.0
 */
export const NotFoundResponse = MessageBody.pipe(
  Schema.decodeTo(
    Schema.toType(NotFound),
    SchemaTransformation.transform({
      decode: (body) => new NotFound(body),
      encode: (error) => ({ message: error.message }),
    })
  ),
  HttpApiSchema.status(404)
).annotate({
  identifier: 'NotFound',
  description: 'Unable to find entity with a given identifier',
});

/**
 * The request did not decode: a bad path, query or body.
 *
 * @since 0.1.0
 */
export class UnprocessableEntity extends Schema.TaggedError<UnprocessableEntity>()(
  'UnprocessableEntity',
  { message: Schema.String }
) {}

/**
 * The wire codec of `UnprocessableEntity`: status 422 with body
 * `{ "message": ... }`.
 *
 * @since 0.1.0
 */
export const UnprocessableEntityResponse = MessageBody.pipe(
  Schema.decodeTo(
    Schema.toType(UnprocessableEntity),
    SchemaTransformation.transform({
      decode: (body) => new UnprocessableEntity(body),
      encode: (error) => ({ message: error.message }),
    })
  ),
  HttpApiSchema.status(422)
).annotate({
  identifier: 'UnprocessableEntity',
  description:
    'Unable to process request. Likely due to improperly formatted request.',
});

/**
 * The task handler could not start a task. The server answers with status 500
 * and stores no task.
 *
 * @since 0.1.0
 */
export class TaskFailed extends Schema.TaggedError<TaskFailed>()('TaskFailed', {
  message: Schema.String,
}) {}

/**
 * The step handler could not execute a step. The server answers with status 500
 * and stores no step.
 *
 * @since 0.1.0
 */
export class StepFailed extends Schema.TaggedError<StepFailed>()('StepFailed', {
  message: Schema.String,
}) {}
