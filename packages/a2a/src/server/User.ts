/**
 * The caller of a request, as an authentication layer reports it.
 *
 * @since 0.1.0
 */
import { Effect } from 'effect';
import type { HttpServerRequest } from 'effect/http';

/**
 * A caller. The task and push stores scope their records by
 * `userName`, through the {@link OwnerResolver} of `ServerCallContext`.
 *
 * @since 0.1.0
 */
export interface User {
  /**
   * False for the {@link UnauthenticatedUser}. With a static extended card,
   * only an authenticated caller gets that card; others get the public one.
   */
  readonly isAuthenticated: boolean;
  /**
   * The owner key of the stores. Empty means anonymous, which the
   * default resolver maps to `unknown`, so all anonymous callers share
   * one scope.
   */
  readonly userName: string;
}

/**
 * The caller of a request without authentication.
 *
 * @since 0.1.0
 */
export const UnauthenticatedUser: User = {
  isAuthenticated: false,
  userName: '',
};

/**
 * Finds the caller of an HTTP request, for example from a bearer token.
 *
 * @since 0.1.0
 */
export type UserBuilder<E = never, R = never> = (
  request: HttpServerRequest.HttpServerRequest
) => Effect.Effect<User, E, R>;

/**
 * The user builders of the reference SDK.
 *
 * @since 0.1.0
 */
export const UserBuilder = {
  /** Every caller is the unauthenticated user. */
  noAuthentication: (() =>
    Effect.succeed(UnauthenticatedUser)) satisfies UserBuilder,
};
