/**
 * The context of one server call: the caller, the tenant, the requested
 * protocol version and the requested and activated extensions.
 *
 * @since 0.1.0
 */
import { Context, Effect, Ref } from 'effect';
import { Headers } from 'effect/http';
import { A2A_LEGACY_PROTOCOL_VERSION } from '../Constants.js';
import * as Extensions from '../Extensions.js';
import { UnauthenticatedUser, type User } from './User.js';

/**
 * The context of one server call. A binding builds it for each request and
 * passes it to the request handler, the stores and the executor.
 *
 * @since 0.1.0
 */
export interface ServerCallContext {
  /** The caller, as the binding's `UserBuilder` found it. */
  readonly user: User;
  /** The tenant of the call; empty when the call names none. */
  readonly tenant: string;
  /**
   * The `A2A-Version` that the caller asked for. A call without the header
   * asks for `0.3`, as the specification requires.
   */
  readonly requestedVersion: string;
  /** The request headers, or the gRPC metadata, of the call. */
  readonly headers: Headers.Headers;
  /** The extensions that the caller asked for, in `A2A-Extensions`. */
  readonly requestedExtensions: Ref.Ref<Extensions.Extensions>;
  /** The extensions that the agent activated; echoed in `A2A-Extensions`. */
  readonly activatedExtensions: Ref.Ref<Extensions.Extensions>;
}

/**
 * The options of {@link make}.
 *
 * @since 0.1.0
 */
export interface MakeOptions {
  /** The caller. The default is the {@link UnauthenticatedUser}. */
  readonly user?: User;
  /** The tenant. The default is empty: no tenant. */
  readonly tenant?: string;
  /** The `A2A-Version` header value. Absent or empty means `0.3`. */
  readonly requestedVersion?: string;
  /** The request headers. The default is no headers. */
  readonly headers?: Headers.Headers;
  /** The extensions that the caller asked for. None are active yet. */
  readonly extensions?: Extensions.Extensions;
}

/**
 * Builds a call context. A missing or empty `requestedVersion` is `0.3`.
 *
 * @since 0.1.0
 */
export const make = (
  options: MakeOptions = {}
): Effect.Effect<ServerCallContext> =>
  Effect.gen(function* () {
    const requestedExtensions = yield* Ref.make(options.extensions ?? []);
    const activatedExtensions = yield* Ref.make<Extensions.Extensions>([]);
    return {
      user: options.user ?? UnauthenticatedUser,
      tenant: options.tenant ?? '',
      requestedVersion:
        options.requestedVersion === undefined ||
        options.requestedVersion === ''
          ? A2A_LEGACY_PROTOCOL_VERSION
          : options.requestedVersion,
      headers: options.headers ?? Headers.empty,
      requestedExtensions,
      activatedExtensions,
    };
  });

/**
 * Marks an extension as activated, so that the binding echoes it in the
 * `A2A-Extensions` response header.
 *
 * @since 0.1.0
 */
export const activateExtension = (
  context: ServerCallContext,
  uri: string
): Effect.Effect<void> =>
  Ref.update(context.activatedExtensions, (current) =>
    Extensions.createFrom(current, uri)
  );

/**
 * Maps a call context to the owner under which the stores keep its records.
 *
 * @since 0.1.0
 */
export type OwnerResolver = (context: ServerCallContext) => string;

/**
 * The default owner: the user name, or `unknown` for a caller without one.
 *
 * @since 0.1.0
 */
export const resolveUserScope: OwnerResolver = (context) =>
  context.user.userName === '' ? 'unknown' : context.user.userName;

/**
 * The owner resolver of the stores. Provide another value to scope records
 * by something other than the user name.
 *
 * @since 0.1.0
 */
export const CurrentOwnerResolver = Context.Reference<OwnerResolver>(
  '@jambudipa/a2a/server/ServerCallContext/CurrentOwnerResolver',
  { defaultValue: () => resolveUserScope }
);

/**
 * The scope of a record: tenant, then owner.
 *
 * @since 0.1.0
 */
export interface CallerScope {
  /** The tenant of the call; empty when the call names none. */
  readonly tenant: string;
  /** The owner that the {@link OwnerResolver} gave for the call. */
  readonly owner: string;
}

/**
 * The tenant and owner of a call.
 *
 * @since 0.1.0
 */
export const callerScope = (
  context: ServerCallContext,
  ownerResolver: OwnerResolver
): CallerScope => ({ tenant: context.tenant, owner: ownerResolver(context) });
