/**
 * Stream operators that a consumer runs over decoded events: `expandChunks`
 * rewrites the chunk shorthands into the bracketed events they stand for,
 * and `verify` checks the ordering rules of the protocol.
 *
 * Both follow `@ag-ui/client` 1.0.4 (`chunks/transform.ts` and
 * `verify/verify.ts`) rule for rule, and fail with `AgUiVerifyError` whose
 * message uses the reference wording, so the shared conformance fixtures
 * hold for both. Run `expandChunks` first: `verify` knows nothing of chunks.
 *
 * ```ts
 * decodeSse(body).pipe(expandChunks, verify)
 * ```
 *
 * @since 0.1.0
 */
import { Effect, Equal, HashMap, HashSet, Option, Stream } from 'effect';
import { AgUiVerifyError } from './Errors.js';
import type { AgUiEvent, AgUiEventOf, EventType } from './Events.js';
import type { Message, TextMessageRole } from './Types.js';

/** The owner of an entity: a subagent, or none for the parent agent. */
type Owner = Option.Option<string>;

/** Whether two owners are the same agent. */
const sameOwner = (a: Owner, b: Owner): boolean => Equal.equals(a, b);

/** Renders an owner as the reference does. */
const ownerName = (owner: Owner): string =>
  Option.getOrElse(owner, () => '(the parent agent)');

/** Builds a verification failure. */
const violation = (eventType: EventType, message: string) =>
  new AgUiVerifyError({ message, eventType });

/** An optional key, present only when the option is. */
const field = <K extends string, A>(
  key: K,
  value: Option.Option<A>
): { readonly [P in K]?: A } =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => ({ [key]: present }) as { readonly [P in K]?: A },
  });

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/** The owners of the entities seen in the run, one map for each kind. */
interface Owners {
  /** Text and tool messages, by message id. */
  readonly message: HashMap.HashMap<string, Owner>;
  /** Tool calls, by tool call id. */
  readonly toolCall: HashMap.HashMap<string, Owner>;
  /** Activity messages, by message id. */
  readonly activity: HashMap.HashMap<string, Owner>;
  /** Reasoning spans and messages, which share one id space. */
  readonly reasoning: HashMap.HashMap<string, Owner>;
}

/** What `verify` remembers between events. */
interface VerifyState {
  /** Whether any event has arrived; the first must open a run. */
  readonly firstEventReceived: boolean;
  /** Whether a `RUN_STARTED` opened the current run. */
  readonly runStarted: boolean;
  /** Whether `RUN_FINISHED` closed the current run. */
  readonly runFinished: boolean;
  /** Whether `RUN_ERROR` ended the current run. */
  readonly runError: boolean;
  /** Open text messages. */
  readonly activeMessages: HashSet.HashSet<string>;
  /** Open tool calls. */
  readonly activeToolCalls: HashSet.HashSet<string>;
  /** Open reasoning spans (`REASONING_START`). */
  readonly activeReasoningSpans: HashSet.HashSet<string>;
  /** Open reasoning messages (`REASONING_MESSAGE_START`). */
  readonly activeReasoningMessages: HashSet.HashSet<string>;
  /** The owner of every entity seen in the run, kept after it closes. */
  readonly owners: Owners;
  /** Open steps, keyed by owner, then by step name. */
  readonly activeSteps: HashMap.HashMap<Owner, HashSet.HashSet<string>>;
  /** Subagent invocations that started and have not ended. */
  readonly activeSubagents: HashSet.HashSet<string>;
  /** Subagent ids closed in this run; an id never starts twice. */
  readonly closedSubagents: HashSet.HashSet<string>;
}

/** The empty owner maps. */
const emptyOwners: Owners = {
  message: HashMap.empty(),
  toolCall: HashMap.empty(),
  activity: HashMap.empty(),
  reasoning: HashMap.empty(),
};

/** The state before any event, or after a reset for a new run. */
const initialVerifyState = (): VerifyState => ({
  firstEventReceived: false,
  runStarted: false,
  runFinished: false,
  runError: false,
  activeMessages: HashSet.empty(),
  activeToolCalls: HashSet.empty(),
  activeReasoningSpans: HashSet.empty(),
  activeReasoningMessages: HashSet.empty(),
  owners: emptyOwners,
  activeSteps: HashMap.empty(),
  activeSubagents: HashSet.empty(),
  closedSubagents: HashSet.empty(),
});

/**
 * Checks that a continuation does not disagree with the owner that opened
 * its entity. An absent tag always agrees.
 */
const tagMismatch = (
  eventType: EventType,
  tag: string | undefined,
  owner: Option.Option<Owner>,
  entityKind: string,
  entityId: string
): Option.Option<AgUiVerifyError> =>
  tag !== undefined &&
  Option.isSome(owner) &&
  !Option.contains(owner.value, tag)
    ? Option.some(
        violation(
          eventType,
          `Cannot send '${eventType}': subagentRunId '${tag}' does not match the ${entityKind} '${entityId}' opener's subagent '${ownerName(owner.value)}'.`
        )
      )
    : Option.none();

/** Fails with the mismatch, if any, else succeeds with `next`. */
const unlessMismatch = (
  mismatch: Option.Option<AgUiVerifyError>,
  next: () => VerifyState
): Effect.Effect<VerifyState, AgUiVerifyError> =>
  Option.match(mismatch, {
    onNone: () => Effect.succeed(next()),
    onSome: Effect.fail,
  });

/** The owner map that a message's role streams through. */
const bucketOf = (role: Message['role']): keyof Owners =>
  role === 'reasoning'
    ? 'reasoning'
    : role === 'activity'
      ? 'activity'
      : 'message';

/**
 * Records the owners of replayed messages (from `MESSAGES_SNAPSHOT` or the
 * `RUN_STARTED` input echo), and of their tool calls. A snapshot is
 * authoritative and replaces a recorded owner; the echo only fills gaps.
 */
const seedOwners = (
  owners: Owners,
  messages: ReadonlyArray<Message>,
  authoritative: boolean
): Owners =>
  messages.reduce<Owners>((acc, message) => {
    const owner = Option.fromUndefinedOr(message.subagentRunId);
    const bucket = bucketOf(message.role);
    const withMessage =
      authoritative || !HashMap.has(acc[bucket], message.id)
        ? { ...acc, [bucket]: HashMap.set(acc[bucket], message.id, owner) }
        : acc;
    const toolCalls =
      message.role === 'assistant' ? (message.toolCalls ?? []) : [];
    return {
      ...withMessage,
      toolCall: toolCalls.reduce(
        (map, call) =>
          authoritative || !HashMap.has(map, call.id)
            ? HashMap.set(map, call.id, owner)
            : map,
        withMessage.toolCall
      ),
    };
  }, owners);

/** Lists open steps as the reference does: `name (subagent 'id')`. */
const listSteps = (steps: VerifyState['activeSteps']): string =>
  [...steps]
    .flatMap(([owner, names]) =>
      [...names].map((name) =>
        Option.match(owner, {
          onNone: () => name,
          onSome: (id) => `${name} (subagent '${id}')`,
        })
      )
    )
    .join(', ');

/** The checks that `RUN_FINISHED` makes: nothing may still be open. */
const openAtRunFinished = (state: VerifyState): Option.Option<string> => {
  const list = (set: HashSet.HashSet<string>) => [...set].join(', ');
  if ([...state.activeSteps].some(([, names]) => HashSet.size(names) > 0)) {
    return Option.some(
      `Cannot send 'RUN_FINISHED' while steps are still active: ${listSteps(state.activeSteps)}`
    );
  }
  if (HashSet.size(state.activeMessages) > 0) {
    return Option.some(
      `Cannot send 'RUN_FINISHED' while text messages are still active: ${list(state.activeMessages)}`
    );
  }
  if (HashSet.size(state.activeReasoningMessages) > 0) {
    return Option.some(
      `Cannot send 'RUN_FINISHED' while reasoning messages are still active: ${list(state.activeReasoningMessages)}`
    );
  }
  if (HashSet.size(state.activeReasoningSpans) > 0) {
    return Option.some(
      `Cannot send 'RUN_FINISHED' while reasoning spans are still active: ${list(state.activeReasoningSpans)}`
    );
  }
  if (HashSet.size(state.activeToolCalls) > 0) {
    return Option.some(
      `Cannot send 'RUN_FINISHED' while tool calls are still active: ${list(state.activeToolCalls)}`
    );
  }
  if (HashSet.size(state.activeSubagents) > 0) {
    return Option.some(
      `Cannot send 'RUN_FINISHED' while subagents are still active: ${list(state.activeSubagents)}`
    );
  }
  return Option.none();
};

/** The steps of one owner. */
const stepsOf = (state: VerifyState, owner: Owner) =>
  Option.getOrElse(HashMap.get(state.activeSteps, owner), () =>
    HashSet.empty<string>()
  );

/** Checks the run lifecycle rules that apply before the per-type rules. */
const checkLifecycle = (
  state: VerifyState,
  event: AgUiEvent
): Effect.Effect<VerifyState, AgUiVerifyError> => {
  const type = event.type;
  if (state.runError && type !== 'RUN_STARTED') {
    return Effect.fail(
      violation(
        type,
        `Cannot send event type '${type}': The run has already errored with 'RUN_ERROR'. No further events can be sent.`
      )
    );
  }
  if (state.runFinished && type !== 'RUN_ERROR' && type !== 'RUN_STARTED') {
    return Effect.fail(
      violation(
        type,
        `Cannot send event type '${type}': The run has already finished with 'RUN_FINISHED'. Start a new run with 'RUN_STARTED'.`
      )
    );
  }
  if (!state.firstEventReceived) {
    return type !== 'RUN_STARTED' && type !== 'RUN_ERROR'
      ? Effect.fail(violation(type, `First event must be 'RUN_STARTED'`))
      : Effect.succeed({ ...state, firstEventReceived: true });
  }
  if (type === 'RUN_STARTED') {
    if (state.runStarted && !state.runFinished && !state.runError) {
      return Effect.fail(
        violation(
          type,
          `Cannot send 'RUN_STARTED' while a run is still active. The previous run must be finished with 'RUN_FINISHED' before starting a new run.`
        )
      );
    }
    if (state.runFinished || state.runError) {
      return Effect.succeed({
        ...initialVerifyState(),
        firstEventReceived: true,
        runStarted: true,
      });
    }
  }
  return Effect.succeed(state);
};

/** Opens a text message. */
const textMessageStart = (
  state: VerifyState,
  event: AgUiEventOf<'TEXT_MESSAGE_START'>
) => {
  const id = event.messageId;
  if (HashSet.has(state.activeMessages, id)) {
    return Effect.fail(
      violation(
        event.type,
        `Cannot send 'TEXT_MESSAGE_START' event: A text message with ID '${id}' is already in progress. Complete it with 'TEXT_MESSAGE_END' first.`
      )
    );
  }
  const existing = HashMap.get(state.owners.message, id);
  return unlessMismatch(
    tagMismatch(event.type, event.subagentRunId, existing, 'message', id),
    () => ({
      ...state,
      activeMessages: HashSet.add(state.activeMessages, id),
      owners: Option.isSome(existing)
        ? state.owners
        : {
            ...state.owners,
            message: HashMap.set(
              state.owners.message,
              id,
              Option.fromUndefinedOr(event.subagentRunId)
            ),
          },
    })
  );
};

/** Continues or closes an open text message. */
const textMessageContinue = (
  state: VerifyState,
  event: AgUiEventOf<'TEXT_MESSAGE_CONTENT' | 'TEXT_MESSAGE_END'>
) => {
  const id = event.messageId;
  if (!HashSet.has(state.activeMessages, id)) {
    return Effect.fail(
      violation(
        event.type,
        event.type === 'TEXT_MESSAGE_CONTENT'
          ? `Cannot send 'TEXT_MESSAGE_CONTENT' event: No active text message found with ID '${id}'. Start a text message with 'TEXT_MESSAGE_START' first.`
          : `Cannot send 'TEXT_MESSAGE_END' event: No active text message found with ID '${id}'. A 'TEXT_MESSAGE_START' event must be sent first.`
      )
    );
  }
  return unlessMismatch(
    tagMismatch(
      event.type,
      event.subagentRunId,
      HashMap.get(state.owners.message, id),
      'message',
      id
    ),
    () =>
      event.type === 'TEXT_MESSAGE_END'
        ? { ...state, activeMessages: HashSet.remove(state.activeMessages, id) }
        : state
  );
};

/** Opens a tool call; an untagged call inherits its parent message's owner. */
const toolCallStart = (
  state: VerifyState,
  event: AgUiEventOf<'TOOL_CALL_START'>
): Effect.Effect<VerifyState, AgUiVerifyError> => {
  const id = event.toolCallId;
  const tag = event.subagentRunId;
  if (HashSet.has(state.activeToolCalls, id)) {
    return Effect.fail(
      violation(
        event.type,
        `Cannot send 'TOOL_CALL_START' event: A tool call with ID '${id}' is already in progress. Complete it with 'TOOL_CALL_END' first.`
      )
    );
  }
  const parentId = event.parentMessageId;
  const inherited =
    parentId === undefined
      ? Option.none<Owner>()
      : HashMap.get(state.owners.message, parentId);
  if (
    tag !== undefined &&
    Option.isSome(inherited) &&
    !Option.contains(inherited.value, tag)
  ) {
    return Effect.fail(
      violation(
        event.type,
        `Cannot send 'TOOL_CALL_START': subagentRunId '${tag}' does not match its parent message '${parentId}' owner '${ownerName(inherited.value)}'. A tool call belongs to the message that carries it.`
      )
    );
  }
  const existing = HashMap.get(state.owners.toolCall, id);
  if (Option.isSome(existing)) {
    const mismatch = tagMismatch(event.type, tag, existing, 'tool call', id);
    if (Option.isSome(mismatch)) return Effect.fail(mismatch.value);
    if (
      tag === undefined &&
      Option.isSome(inherited) &&
      !sameOwner(inherited.value, existing.value)
    ) {
      return Effect.fail(
        violation(
          event.type,
          `Cannot send 'TOOL_CALL_START': tool call '${id}' is owned by '${ownerName(existing.value)}' but its parent message '${parentId}' is owned by '${ownerName(inherited.value)}'. A tool call belongs to the message that carries it.`
        )
      );
    }
  }
  const owner: Owner =
    tag !== undefined
      ? Option.some(tag)
      : Option.getOrElse(inherited, () => Option.none<string>());
  return Effect.succeed({
    ...state,
    activeToolCalls: HashSet.add(state.activeToolCalls, id),
    owners: Option.isSome(existing)
      ? state.owners
      : {
          ...state.owners,
          toolCall: HashMap.set(state.owners.toolCall, id, owner),
        },
  });
};

/** Continues or closes an open tool call. */
const toolCallContinue = (
  state: VerifyState,
  event: AgUiEventOf<'TOOL_CALL_ARGS' | 'TOOL_CALL_END'>
) => {
  const id = event.toolCallId;
  if (!HashSet.has(state.activeToolCalls, id)) {
    return Effect.fail(
      violation(
        event.type,
        event.type === 'TOOL_CALL_ARGS'
          ? `Cannot send 'TOOL_CALL_ARGS' event: No active tool call found with ID '${id}'. Start a tool call with 'TOOL_CALL_START' first.`
          : `Cannot send 'TOOL_CALL_END' event: No active tool call found with ID '${id}'. A 'TOOL_CALL_START' event must be sent first.`
      )
    );
  }
  return unlessMismatch(
    tagMismatch(
      event.type,
      event.subagentRunId,
      HashMap.get(state.owners.toolCall, id),
      'tool call',
      id
    ),
    () =>
      event.type === 'TOOL_CALL_END'
        ? {
            ...state,
            activeToolCalls: HashSet.remove(state.activeToolCalls, id),
          }
        : state
  );
};

/** Opens a named step, keyed by owner and name. */
const stepStarted = (
  state: VerifyState,
  event: AgUiEventOf<'STEP_STARTED'>
) => {
  const owner = Option.fromUndefinedOr(event.subagentRunId);
  const steps = stepsOf(state, owner);
  if (HashSet.has(steps, event.stepName)) {
    return Effect.fail(
      violation(
        event.type,
        `Step "${event.stepName}" is already active for 'STEP_STARTED'${Option.match(
          owner,
          { onNone: () => '', onSome: (id) => ` in subagent '${id}'` }
        )}`
      )
    );
  }
  return Effect.succeed({
    ...state,
    activeSteps: HashMap.set(
      state.activeSteps,
      owner,
      HashSet.add(steps, event.stepName)
    ),
  });
};

/** Closes a named step; only its owner may close it. */
const stepFinished = (
  state: VerifyState,
  event: AgUiEventOf<'STEP_FINISHED'>
) => {
  const owner = Option.fromUndefinedOr(event.subagentRunId);
  const steps = stepsOf(state, owner);
  const name = event.stepName;
  if (!HashSet.has(steps, name)) {
    const other = [...state.activeSteps].find(
      ([candidate, names]) =>
        !sameOwner(candidate, owner) && HashSet.has(names, name)
    );
    const who = (o: Owner) =>
      Option.match(o, {
        onNone: () => 'the parent agent',
        onSome: (id) => `subagent '${id}'`,
      });
    return Effect.fail(
      violation(
        event.type,
        other === undefined
          ? `Cannot send 'STEP_FINISHED' for step "${name}" that was not started`
          : `Cannot send 'STEP_FINISHED' for step "${name}" attributed to ${who(owner)}: that step is open under ${who(other[0])}. A step must be finished by whoever started it.`
      )
    );
  }
  return Effect.succeed({
    ...state,
    activeSteps: HashMap.set(state.activeSteps, owner, HashSet.remove(steps, name)),
  });
};

/** Opens a reasoning span or a reasoning message. */
const reasoningOpen = (
  state: VerifyState,
  event: AgUiEventOf<'REASONING_START' | 'REASONING_MESSAGE_START'>
) => {
  const id = event.messageId;
  const isSpan = event.type === 'REASONING_START';
  const open = isSpan ? state.activeReasoningSpans : state.activeReasoningMessages;
  if (HashSet.has(open, id)) {
    return Effect.fail(
      violation(
        event.type,
        isSpan
          ? `Cannot send 'REASONING_START' event: A reasoning span with ID '${id}' is already in progress. Complete it with 'REASONING_END' first.`
          : `Cannot send 'REASONING_MESSAGE_START' event: A reasoning message with ID '${id}' is already in progress. Complete it with 'REASONING_MESSAGE_END' first.`
      )
    );
  }
  const existing = HashMap.get(state.owners.reasoning, id);
  return unlessMismatch(
    tagMismatch(event.type, event.subagentRunId, existing, 'reasoning message', id),
    () => ({
      ...state,
      ...(isSpan
        ? { activeReasoningSpans: HashSet.add(open, id) }
        : { activeReasoningMessages: HashSet.add(open, id) }),
      owners: Option.isSome(existing)
        ? state.owners
        : {
            ...state.owners,
            reasoning: HashMap.set(
              state.owners.reasoning,
              id,
              Option.fromUndefinedOr(event.subagentRunId)
            ),
          },
    })
  );
};

/** Continues or closes a reasoning span or message. */
const reasoningContinue = (
  state: VerifyState,
  event: AgUiEventOf<
    'REASONING_MESSAGE_CONTENT' | 'REASONING_MESSAGE_END' | 'REASONING_END'
  >
) => {
  const id = event.messageId;
  const isSpan = event.type === 'REASONING_END';
  const open = isSpan ? state.activeReasoningSpans : state.activeReasoningMessages;
  if (!HashSet.has(open, id)) {
    return Effect.fail(
      violation(
        event.type,
        isSpan
          ? `Cannot send 'REASONING_END' event: No active reasoning span found with ID '${id}'. A 'REASONING_START' event must be sent first.`
          : `Cannot send '${event.type}' event: No active reasoning message found with ID '${id}'. Start a reasoning message with 'REASONING_MESSAGE_START' first.`
      )
    );
  }
  return unlessMismatch(
    tagMismatch(
      event.type,
      event.subagentRunId,
      HashMap.get(state.owners.reasoning, id),
      'reasoning message',
      id
    ),
    () =>
      event.type === 'REASONING_MESSAGE_CONTENT'
        ? state
        : isSpan
          ? { ...state, activeReasoningSpans: HashSet.remove(open, id) }
          : { ...state, activeReasoningMessages: HashSet.remove(open, id) }
  );
};

/** Checks an encrypted value against the owner of the entity it names. */
const encryptedValue = (
  state: VerifyState,
  event: AgUiEventOf<'REASONING_ENCRYPTED_VALUE'>
) => {
  const id = event.entityId;
  const owner =
    event.subtype === 'tool-call'
      ? HashMap.get(state.owners.toolCall, id)
      : Option.orElse(HashMap.get(state.owners.message, id), () =>
          HashMap.get(state.owners.reasoning, id)
        );
  return unlessMismatch(
    tagMismatch(
      event.type,
      event.subagentRunId,
      owner,
      event.subtype === 'tool-call' ? 'tool call' : 'message',
      id
    ),
    () => state
  );
};

/** Starts a subagent invocation. */
const subagentStarted = (
  state: VerifyState,
  event: AgUiEventOf<'SUBAGENT_STARTED'>
) => {
  const id = event.subagentRunId;
  const parent = event.parentSubagentRunId;
  if (HashSet.has(state.activeSubagents, id)) {
    return Effect.fail(
      violation(
        event.type,
        `Cannot send 'SUBAGENT_STARTED': subagent '${id}' is already active. Finish it with 'SUBAGENT_FINISHED' first.`
      )
    );
  }
  if (HashSet.has(state.closedSubagents, id)) {
    return Effect.fail(
      violation(
        event.type,
        `Cannot send 'SUBAGENT_STARTED': subagent '${id}' has already finished in this run. Subagent IDs are per-invocation and cannot be reused.`
      )
    );
  }
  if (
    parent !== undefined &&
    !HashSet.has(state.activeSubagents, parent) &&
    !HashSet.has(state.closedSubagents, parent)
  ) {
    return Effect.fail(
      violation(
        event.type,
        `Cannot send 'SUBAGENT_STARTED': parentSubagentRunId '${parent}' has not been started in this run.`
      )
    );
  }
  return Effect.succeed({
    ...state,
    activeSubagents: HashSet.add(state.activeSubagents, id),
  });
};

/** Ends a subagent invocation. */
const subagentEnded = (
  state: VerifyState,
  event: AgUiEventOf<'SUBAGENT_FINISHED' | 'SUBAGENT_ERROR'>
) => {
  const id = event.subagentRunId;
  if (!HashSet.has(state.activeSubagents, id)) {
    return Effect.fail(
      violation(
        event.type,
        `Cannot send '${event.type}': no active subagent found with ID '${id}'. A 'SUBAGENT_STARTED' event must be sent first.`
      )
    );
  }
  return Effect.succeed({
    ...state,
    activeSubagents: HashSet.remove(state.activeSubagents, id),
    closedSubagents: HashSet.add(state.closedSubagents, id),
  });
};

/** Applies the per-type rules to an event that passed the lifecycle checks. */
const checkEvent = (
  state: VerifyState,
  event: AgUiEvent
): Effect.Effect<VerifyState, AgUiVerifyError> => {
  switch (event.type) {
    case 'TEXT_MESSAGE_START':
      return textMessageStart(state, event);
    case 'TEXT_MESSAGE_CONTENT':
    case 'TEXT_MESSAGE_END':
      return textMessageContinue(state, event);
    case 'TOOL_CALL_START':
      return toolCallStart(state, event);
    case 'TOOL_CALL_ARGS':
    case 'TOOL_CALL_END':
      return toolCallContinue(state, event);
    case 'STEP_STARTED':
      return stepStarted(state, event);
    case 'STEP_FINISHED':
      return stepFinished(state, event);
    case 'ACTIVITY_SNAPSHOT': {
      const id = event.messageId;
      const replaces =
        !HashMap.has(state.owners.activity, id) || event.replace !== false;
      return Effect.succeed(
        replaces
          ? {
              ...state,
              owners: {
                ...state.owners,
                activity: HashMap.set(
                  state.owners.activity,
                  id,
                  Option.fromUndefinedOr(event.subagentRunId)
                ),
              },
            }
          : state
      );
    }
    case 'ACTIVITY_DELTA':
      return unlessMismatch(
        tagMismatch(
          event.type,
          event.subagentRunId,
          HashMap.get(state.owners.activity, event.messageId),
          'activity',
          event.messageId
        ),
        () => state
      );
    case 'TOOL_CALL_RESULT':
      return Effect.succeed({
        ...state,
        owners: {
          ...state.owners,
          message: HashMap.set(
            state.owners.message,
            event.messageId,
            Option.fromUndefinedOr(event.subagentRunId)
          ),
        },
      });
    case 'REASONING_START':
    case 'REASONING_MESSAGE_START':
      return reasoningOpen(state, event);
    case 'REASONING_MESSAGE_CONTENT':
    case 'REASONING_MESSAGE_END':
    case 'REASONING_END':
      return reasoningContinue(state, event);
    case 'REASONING_ENCRYPTED_VALUE':
      return encryptedValue(state, event);
    case 'SUBAGENT_STARTED':
      return subagentStarted(state, event);
    case 'SUBAGENT_FINISHED':
    case 'SUBAGENT_ERROR':
      return subagentEnded(state, event);
    case 'MESSAGES_SNAPSHOT':
      return Effect.succeed({
        ...state,
        owners: seedOwners(state.owners, event.messages, true),
      });
    case 'RUN_STARTED':
      return Effect.succeed({
        ...state,
        runStarted: true,
        owners: seedOwners(state.owners, event.input?.messages ?? [], false),
      });
    case 'RUN_FINISHED':
      return Option.match(openAtRunFinished(state), {
        onNone: () => Effect.succeed({ ...state, runFinished: true }),
        onSome: (message) => Effect.fail(violation(event.type, message)),
      });
    case 'RUN_ERROR':
      return Effect.succeed({ ...state, runError: true });
    default:
      return Effect.succeed(state);
  }
};

/**
 * Verifies that a stream of events follows the AG-UI ordering rules: a run
 * opens with `RUN_STARTED`, every message, tool call, reasoning span and step
 * is opened before it is continued and closed before `RUN_FINISHED`, nothing
 * follows `RUN_ERROR` but a new run, and subagent attribution agrees with
 * the opener. The first broken rule fails the stream with `AgUiVerifyError`.
 * Events pass through unchanged.
 *
 * @since 0.1.0
 */
export const verify = <E, R>(
  events: Stream.Stream<AgUiEvent, E, R>
): Stream.Stream<AgUiEvent, E | AgUiVerifyError, R> =>
  events.pipe(
    Stream.mapAccumEffect(initialVerifyState, (state, event: AgUiEvent) =>
      checkLifecycle(state, event).pipe(
        Effect.flatMap((checked) => checkEvent(checked, event)),
        Effect.map((next) => [next, [event]] as const)
      )
    )
  );

// ---------------------------------------------------------------------------
// expandChunks
// ---------------------------------------------------------------------------

/** A chunk stream that is open in one lane. */
type Pending =
  | {
      readonly kind: 'text';
      readonly messageId: string;
      readonly role: TextMessageRole;
      readonly name: Option.Option<string>;
      readonly subagentRunId: Option.Option<string>;
    }
  | {
      readonly kind: 'tool';
      readonly toolCallId: string;
      readonly toolCallName: string;
      readonly parentMessageId: Option.Option<string>;
      readonly subagentRunId: Option.Option<string>;
    }
  | {
      readonly kind: 'reasoning';
      readonly messageId: string;
      readonly subagentRunId: Option.Option<string>;
    };

/** The open chunk streams, one lane for each owner. */
type Lanes = HashMap.HashMap<Owner, Pending>;

/** The id of a pending stream's entity. */
const pendingId = (pending: Pending): string =>
  pending.kind === 'tool' ? pending.toolCallId : pending.messageId;

/** The event that closes a pending stream. */
const closer = (pending: Pending): AgUiEvent => {
  const owner = field('subagentRunId', pending.subagentRunId);
  switch (pending.kind) {
    case 'text':
      return { type: 'TEXT_MESSAGE_END', messageId: pending.messageId, ...owner };
    case 'tool':
      return { type: 'TOOL_CALL_END', toolCallId: pending.toolCallId, ...owner };
    case 'reasoning':
      return {
        type: 'REASONING_MESSAGE_END',
        messageId: pending.messageId,
        ...owner,
      };
  }
};

/** Closes the lane of one owner, giving the closing event if it was open. */
const closeLane = (
  lanes: Lanes,
  owner: Owner
): readonly [Lanes, ReadonlyArray<AgUiEvent>] =>
  Option.match(HashMap.get(lanes, owner), {
    onNone: () => [lanes, []] as const,
    onSome: (pending) => [HashMap.remove(lanes, owner), [closer(pending)]] as const,
  });

/** Closes every lane. */
const closeAll = (lanes: Lanes): readonly [Lanes, ReadonlyArray<AgUiEvent>] => [
  HashMap.empty(),
  [...HashMap.values(lanes)].map(closer),
];

/** The chunk metadata carried onto a synthesised opener. */
const chunkMetadata = (chunk: AgUiEvent) =>
  field('metadata', Option.fromUndefinedOr(chunk.metadata));

/** The chunk metadata and raw event carried onto synthesised content. */
const chunkOrigin = (chunk: AgUiEvent) => ({
  ...chunkMetadata(chunk),
  ...field('rawEvent', Option.fromUndefinedOr(chunk.rawEvent)),
});

/** A chunk failure, in the reference wording. */
const chunkFailure = (eventType: EventType, message: string) =>
  Effect.fail(violation(eventType, message));

/**
 * Picks the lane of a chunk: the lane already holding its entity, else its
 * tag, else the one open lane of its kind.
 */
const resolveLane = (
  lanes: Lanes,
  kind: Pending['kind'],
  entityId: string | undefined,
  tag: string | undefined,
  chunkType: EventType,
  entityKind: string
): Effect.Effect<Owner, AgUiVerifyError> => {
  const entries = [...lanes];
  if (entityId !== undefined) {
    const holder = entries.find(
      ([, pending]) => pending.kind === kind && pendingId(pending) === entityId
    );
    if (holder !== undefined) {
      return tag !== undefined && !Option.contains(holder[0], tag)
        ? chunkFailure(
            chunkType,
            `Cannot continue ${entityKind} '${entityId}': chunk subagentRunId '${tag}' does not match the open stream's subagent '${ownerName(holder[0])}'.`
          )
        : Effect.succeed(holder[0]);
    }
    return Effect.succeed(Option.fromUndefinedOr(tag));
  }
  if (tag !== undefined) return Effect.succeed(Option.some(tag));
  const parent = HashMap.get(lanes, Option.none());
  if (Option.isSome(parent) && parent.value.kind === kind) {
    return Effect.succeed(Option.none());
  }
  const candidates = entries.filter(([, pending]) => pending.kind === kind);
  if (candidates.length > 1) {
    return chunkFailure(
      chunkType,
      `Ambiguous ${chunkType}: it carries neither a ${kind === 'tool' ? 'toolCallId' : 'messageId'} nor a subagentRunId, but ${candidates.length} lanes have an open ${entityKind}. Attribute the chunk to the subagent it belongs to.`
    );
  }
  return Effect.succeed(
    candidates[0] === undefined ? Option.none() : candidates[0][0]
  );
};

/** Requires a continuation field to agree with the opener's value. */
const agree = (
  chunkType: EventType,
  entityKind: string,
  entityId: string,
  name: string,
  incoming: string | undefined,
  established: Option.Option<string>
): Option.Option<AgUiVerifyError> =>
  incoming !== undefined && !Option.contains(established, incoming)
    ? Option.some(
        violation(
          chunkType,
          `Cannot continue ${entityKind} '${entityId}': chunk ${name} '${incoming}' does not match the open stream's ${name} ${Option.match(
            established,
            { onNone: () => '(absent)', onSome: (value) => `'${value}'` }
          )}.`
        )
      )
    : Option.none();

/** The first failure of several checks. */
const firstFailure = (
  checks: ReadonlyArray<Option.Option<AgUiVerifyError>>
): Option.Option<AgUiVerifyError> =>
  Option.firstSomeOf(checks);

/** The result of one step of chunk expansion. */
type Step = Effect.Effect<
  readonly [Lanes, ReadonlyArray<AgUiEvent>],
  AgUiVerifyError
>;

/** Expands a `TEXT_MESSAGE_CHUNK`. */
const textChunk = (
  lanes: Lanes,
  chunk: AgUiEventOf<'TEXT_MESSAGE_CHUNK'>
): Step =>
  Effect.gen(function* () {
    const lane = yield* resolveLane(
      lanes,
      'text',
      chunk.messageId,
      chunk.subagentRunId,
      chunk.type,
      'text message'
    );
    const open = HashMap.get(lanes, lane);
    const continues =
      Option.isSome(open) &&
      open.value.kind === 'text' &&
      (chunk.messageId === undefined || chunk.messageId === open.value.messageId)
        ? Option.some(open.value)
        : Option.none();
    if (Option.isSome(continues)) {
      const fields = continues.value;
      const mismatch = firstFailure([
        agree(chunk.type, 'text message', fields.messageId, 'role', chunk.role, Option.some(fields.role)),
        agree(chunk.type, 'text message', fields.messageId, 'name', chunk.name, fields.name),
      ]);
      if (Option.isSome(mismatch)) return yield* Effect.fail(mismatch.value);
      return [lanes, textContent(chunk, fields, [])] as const;
    }
    const [closed, ended] = closeLane(lanes, lane);
    if (chunk.messageId === undefined) {
      return yield* chunkFailure(
        chunk.type,
        'First TEXT_MESSAGE_CHUNK must have a messageId'
      );
    }
    const fields = {
      kind: 'text',
      messageId: chunk.messageId,
      role: chunk.role ?? 'assistant',
      name: Option.fromUndefinedOr(chunk.name),
      subagentRunId: Option.fromUndefinedOr(chunk.subagentRunId),
    } as const;
    const start: AgUiEvent = {
      type: 'TEXT_MESSAGE_START',
      messageId: fields.messageId,
      role: fields.role,
      ...field('name', fields.name),
      ...field('subagentRunId', fields.subagentRunId),
      ...chunkMetadata(chunk),
    };
    return [
      HashMap.set(closed, lane, fields),
      textContent(chunk, fields, [...ended, start]),
    ] as const;
  });

/** Appends the content event of a text chunk, when it carries anything. */
const textContent = (
  chunk: AgUiEventOf<'TEXT_MESSAGE_CHUNK'>,
  fields: Extract<Pending, { readonly kind: 'text' }>,
  before: ReadonlyArray<AgUiEvent>
): ReadonlyArray<AgUiEvent> => {
  const owner = chunk.subagentRunId ?? Option.getOrUndefined(fields.subagentRunId);
  const content: AgUiEvent = {
    type: 'TEXT_MESSAGE_CONTENT',
    messageId: fields.messageId,
    delta: chunk.delta ?? '',
    ...field('subagentRunId', Option.fromUndefinedOr(owner)),
    ...chunkOrigin(chunk),
  };
  const carries =
    chunk.delta !== undefined || chunk.rawEvent !== undefined;
  const metadataOnly = before.length === 0 && chunk.metadata !== undefined;
  return carries || metadataOnly ? [...before, content] : before;
};

/** Expands a `TOOL_CALL_CHUNK`. */
const toolChunk = (
  lanes: Lanes,
  chunk: AgUiEventOf<'TOOL_CALL_CHUNK'>
): Step =>
  Effect.gen(function* () {
    const lane = yield* resolveLane(
      lanes,
      'tool',
      chunk.toolCallId,
      chunk.subagentRunId,
      chunk.type,
      'tool call'
    );
    const open = HashMap.get(lanes, lane);
    const continues =
      Option.isSome(open) &&
      open.value.kind === 'tool' &&
      (chunk.toolCallId === undefined ||
        chunk.toolCallId === open.value.toolCallId)
        ? Option.some(open.value)
        : Option.none();
    if (Option.isSome(continues)) {
      const fields = continues.value;
      const mismatch = firstFailure([
        agree(chunk.type, 'tool call', fields.toolCallId, 'toolCallName', chunk.toolCallName, Option.some(fields.toolCallName)),
        agree(chunk.type, 'tool call', fields.toolCallId, 'parentMessageId', chunk.parentMessageId, fields.parentMessageId),
      ]);
      if (Option.isSome(mismatch)) return yield* Effect.fail(mismatch.value);
      return [lanes, toolArgs(chunk, fields, [])] as const;
    }
    const [closed, ended] = closeLane(lanes, lane);
    if (chunk.toolCallId === undefined) {
      return yield* chunkFailure(
        chunk.type,
        'First TOOL_CALL_CHUNK must have a toolCallId'
      );
    }
    if (chunk.toolCallName === undefined) {
      return yield* chunkFailure(
        chunk.type,
        'First TOOL_CALL_CHUNK must have a toolCallName'
      );
    }
    const fields = {
      kind: 'tool',
      toolCallId: chunk.toolCallId,
      toolCallName: chunk.toolCallName,
      parentMessageId: Option.fromUndefinedOr(chunk.parentMessageId),
      subagentRunId: Option.fromUndefinedOr(chunk.subagentRunId),
    } as const;
    const start: AgUiEvent = {
      type: 'TOOL_CALL_START',
      toolCallId: fields.toolCallId,
      toolCallName: fields.toolCallName,
      ...field('parentMessageId', fields.parentMessageId),
      ...field('subagentRunId', fields.subagentRunId),
      ...chunkMetadata(chunk),
    };
    return [
      HashMap.set(closed, lane, fields),
      toolArgs(chunk, fields, [...ended, start]),
    ] as const;
  });

/** Appends the args event of a tool chunk, when it carries anything. */
const toolArgs = (
  chunk: AgUiEventOf<'TOOL_CALL_CHUNK'>,
  fields: Extract<Pending, { readonly kind: 'tool' }>,
  before: ReadonlyArray<AgUiEvent>
): ReadonlyArray<AgUiEvent> => {
  const owner = chunk.subagentRunId ?? Option.getOrUndefined(fields.subagentRunId);
  const args: AgUiEvent = {
    type: 'TOOL_CALL_ARGS',
    toolCallId: fields.toolCallId,
    delta: chunk.delta ?? '',
    ...field('subagentRunId', Option.fromUndefinedOr(owner)),
    ...chunkOrigin(chunk),
  };
  const carries =
    chunk.delta !== undefined || chunk.rawEvent !== undefined;
  const metadataOnly = before.length === 0 && chunk.metadata !== undefined;
  return carries || metadataOnly ? [...before, args] : before;
};

/** Expands a `REASONING_MESSAGE_CHUNK`. */
const reasoningChunk = (
  lanes: Lanes,
  chunk: AgUiEventOf<'REASONING_MESSAGE_CHUNK'>
): Step =>
  Effect.gen(function* () {
    const lane = yield* resolveLane(
      lanes,
      'reasoning',
      chunk.messageId,
      chunk.subagentRunId,
      chunk.type,
      'reasoning message'
    );
    const open = HashMap.get(lanes, lane);
    if (
      Option.isSome(open) &&
      open.value.kind === 'reasoning' &&
      (chunk.messageId === undefined || chunk.messageId === open.value.messageId)
    ) {
      return [lanes, reasoningContent(chunk, open.value, [])] as const;
    }
    const [closed, ended] = closeLane(lanes, lane);
    if (chunk.messageId === undefined) {
      return yield* chunkFailure(
        chunk.type,
        'First REASONING_MESSAGE_CHUNK must have a messageId'
      );
    }
    const fields = {
      kind: 'reasoning',
      messageId: chunk.messageId,
      subagentRunId: Option.fromUndefinedOr(chunk.subagentRunId),
    } as const;
    const start: AgUiEvent = {
      type: 'REASONING_MESSAGE_START',
      messageId: fields.messageId,
      role: 'reasoning',
      ...field('subagentRunId', fields.subagentRunId),
      ...chunkMetadata(chunk),
    };
    return [
      HashMap.set(closed, lane, fields),
      reasoningContent(chunk, fields, [...ended, start]),
    ] as const;
  });

/** Appends the content event of a reasoning chunk, when it carries anything. */
const reasoningContent = (
  chunk: AgUiEventOf<'REASONING_MESSAGE_CHUNK'>,
  fields: Extract<Pending, { readonly kind: 'reasoning' }>,
  before: ReadonlyArray<AgUiEvent>
): ReadonlyArray<AgUiEvent> => {
  const owner = chunk.subagentRunId ?? Option.getOrUndefined(fields.subagentRunId);
  const content: AgUiEvent = {
    type: 'REASONING_MESSAGE_CONTENT',
    messageId: fields.messageId,
    delta: chunk.delta ?? '',
    ...field('subagentRunId', Option.fromUndefinedOr(owner)),
    ...chunkOrigin(chunk),
  };
  const carries =
    chunk.delta !== undefined || chunk.rawEvent !== undefined;
  const metadataOnly = before.length === 0 && chunk.metadata !== undefined;
  return carries || metadataOnly ? [...before, content] : before;
};

/** Emits an event after closing the lane of its own owner. */
const afterClosingOwn = (
  lanes: Lanes,
  event: AgUiEvent,
  owner: string | undefined
): Step => {
  const [closed, ended] = closeLane(lanes, Option.fromUndefinedOr(owner));
  return Effect.succeed([closed, [...ended, event]] as const);
};

/** One step of chunk expansion. */
const expandStep = (lanes: Lanes, event: AgUiEvent): Step => {
  switch (event.type) {
    case 'TEXT_MESSAGE_CHUNK':
      return textChunk(lanes, event);
    case 'TOOL_CALL_CHUNK':
      return toolChunk(lanes, event);
    case 'REASONING_MESSAGE_CHUNK':
      return reasoningChunk(lanes, event);
    case 'RUN_STARTED':
    case 'RUN_FINISHED':
    case 'RUN_ERROR':
    case 'MESSAGES_SNAPSHOT': {
      const [closed, ended] = closeAll(lanes);
      return Effect.succeed([closed, [...ended, event]] as const);
    }
    case 'RAW':
    case 'ACTIVITY_SNAPSHOT':
    case 'ACTIVITY_DELTA':
    case 'REASONING_ENCRYPTED_VALUE':
    case 'SUBAGENT_STARTED':
      return Effect.succeed([lanes, [event]] as const);
    case 'SUBAGENT_FINISHED':
    case 'SUBAGENT_ERROR':
      return afterClosingOwn(lanes, event, event.subagentRunId);
    default:
      return afterClosingOwn(lanes, event, event.subagentRunId);
  }
};

/**
 * Expands `TEXT_MESSAGE_CHUNK`, `TOOL_CALL_CHUNK` and
 * `REASONING_MESSAGE_CHUNK` into the start, content (or args) and end events
 * they stand for. A chunk without an id continues the stream open in its
 * lane; one lane is kept for each subagent. Any other bracketed event closes
 * the open chunk stream of its own lane; a run boundary closes every lane.
 * A continuation whose `role`, `name`, `toolCallName` or `parentMessageId`
 * disagrees with the opener fails with `AgUiVerifyError`.
 *
 * @since 0.1.0
 */
export const expandChunks = <E, R>(
  events: Stream.Stream<AgUiEvent, E, R>
): Stream.Stream<AgUiEvent, E | AgUiVerifyError, R> =>
  events.pipe(
    Stream.mapAccumEffect(
      (): Lanes => HashMap.empty(),
      (lanes, event: AgUiEvent) => expandStep(lanes, event)
    )
  );
