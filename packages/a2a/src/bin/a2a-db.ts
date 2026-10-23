#!/usr/bin/env node
/**
 * The `a2a-db` executable: the process entry of `server/sql/Cli.ts`. It
 * exits with status 1 when a command fails; the command has already printed
 * the reason.
 *
 * @since 0.1.0
 */
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { main } from '../server/sql/Cli.js';

main.pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true })
);
