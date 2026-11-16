/**
 * A run that uses every corner of the data model: every message role and
 * content part kind, a tool result with parts, state and activity patches,
 * reasoning, subagents, an interrupt outcome and token usage. The schema,
 * protobuf and server tests share it.
 */
import type { AgUiEvent, RunAgentInput } from '../src/index.js';

/** A request that carries every message role and part kind. */
export const richInput: RunAgentInput = {
  threadId: 'thread-1',
  runId: 'run-1',
  protocolVersion: '1.0',
  state: { count: 1 },
  messages: [
    { id: 'm-dev', role: 'developer', content: 'Be brief.' },
    { id: 'm-sys', role: 'system', content: 'You are helpful.', name: 'sys' },
    {
      id: 'm-user',
      role: 'user',
      content: [
        { type: 'text', text: 'Look at this', metadata: { source: 'kb' } },
        {
          type: 'image',
          source: { type: 'data', value: 'AAAA', mimeType: 'image/png' },
        },
        { type: 'audio', source: { type: 'url', value: 'https://a/b.mp3' } },
        {
          type: 'document',
          id: 'doc-1',
          source: { type: 'file', value: 'file-1', provider: 'openai' },
        },
      ],
    },
    {
      id: 'm-asst',
      role: 'assistant',
      toolCalls: [
        {
          id: 'tc-1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"x"}' },
          metadata: { tag: 1 },
        },
      ],
    },
    { id: 'm-tool', role: 'tool', content: 'found', toolCallId: 'tc-1' },
    {
      id: 'm-act',
      role: 'activity',
      activityType: 'progress',
      content: { percent: 50 },
    },
    { id: 'm-reason', role: 'reasoning', content: 'thinking' },
  ],
  tools: [
    {
      name: 'search',
      description: 'Searches',
      parameters: { type: 'object' },
    },
  ],
  context: [{ description: 'locale', value: 'en-GB' }],
  forwardedProps: { feature: true },
  resume: [{ interruptId: 'i-0', status: 'resolved', payload: { ok: true } }],
};

/** A verified run that exercises every event family. */
export const richRun: ReadonlyArray<AgUiEvent> = [
  {
    type: 'RUN_STARTED',
    threadId: 'thread-1',
    runId: 'run-1',
    protocolVersion: '1.0',
    input: richInput,
    timestamp: 1700000000000,
  },
  { type: 'STEP_STARTED', stepName: 'plan' },
  { type: 'TEXT_MESSAGE_START', messageId: 'a-1', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a-1', delta: 'Hello' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a-1', delta: '' },
  { type: 'TEXT_MESSAGE_END', messageId: 'a-1', metadata: { done: true } },
  {
    type: 'TOOL_CALL_START',
    toolCallId: 'tc-2',
    toolCallName: 'search',
    parentMessageId: 'a-1',
  },
  { type: 'TOOL_CALL_ARGS', toolCallId: 'tc-2', delta: '{"q":"y"}' },
  { type: 'TOOL_CALL_END', toolCallId: 'tc-2' },
  {
    type: 'TOOL_CALL_RESULT',
    messageId: 'r-1',
    toolCallId: 'tc-2',
    content: [
      { type: 'text', text: 'result' },
      { type: 'video', source: { type: 'url', value: 'https://v', mimeType: 'video/mp4' } },
    ],
    role: 'tool',
  },
  { type: 'STATE_SNAPSHOT', snapshot: { items: [1, 2] } },
  {
    type: 'STATE_DELTA',
    delta: [
      { op: 'add', path: '/items/-', value: null },
      { op: 'move', from: '/items/0', path: '/first' },
      { op: 'test', path: '/first', value: 1 },
    ],
  },
  {
    type: 'ACTIVITY_SNAPSHOT',
    messageId: 'act-1',
    activityType: 'progress',
    content: { percent: 10 },
    replace: false,
  },
  {
    type: 'ACTIVITY_DELTA',
    messageId: 'act-1',
    activityType: 'progress',
    patch: [{ op: 'replace', path: '/percent', value: 20 }],
  },
  { type: 'RAW', event: ['provider', 1], source: 'openai' },
  { type: 'CUSTOM', name: 'ping', value: null },
  { type: 'REASONING_START', messageId: 'th-1' },
  { type: 'REASONING_MESSAGE_START', messageId: 'th-1', role: 'reasoning' },
  { type: 'REASONING_MESSAGE_CONTENT', messageId: 'th-1', delta: 'hmm' },
  { type: 'REASONING_MESSAGE_END', messageId: 'th-1' },
  { type: 'REASONING_END', messageId: 'th-1' },
  {
    type: 'REASONING_ENCRYPTED_VALUE',
    subtype: 'message',
    entityId: 'th-1',
    encryptedValue: 'opaque',
  },
  {
    type: 'SUBAGENT_STARTED',
    subagentRunId: 's-1',
    name: 'researcher',
    description: 'Finds things',
    parentToolCallId: 'tc-2',
  },
  {
    type: 'TEXT_MESSAGE_START',
    messageId: 'sub-m',
    role: 'assistant',
    subagentRunId: 's-1',
  },
  {
    type: 'TEXT_MESSAGE_CONTENT',
    messageId: 'sub-m',
    delta: 'from the subagent',
    subagentRunId: 's-1',
  },
  { type: 'TEXT_MESSAGE_END', messageId: 'sub-m', subagentRunId: 's-1' },
  {
    type: 'SUBAGENT_FINISHED',
    subagentRunId: 's-1',
    result: { found: 3 },
    outcome: { type: 'suspended', interruptIds: ['i-1'] },
  },
  { type: 'SUBAGENT_STARTED', subagentRunId: 's-2', name: 'writer' },
  { type: 'SUBAGENT_ERROR', subagentRunId: 's-2', message: 'gave up', code: 'E1' },
  {
    type: 'MESSAGES_SNAPSHOT',
    messages: [{ id: 'a-1', role: 'assistant', content: 'Hello' }],
  },
  { type: 'STEP_FINISHED', stepName: 'plan' },
  {
    type: 'RUN_FINISHED',
    threadId: 'thread-1',
    runId: 'run-1',
    result: 'done',
    outcome: {
      type: 'interrupt',
      interrupts: [
        {
          id: 'i-1',
          reason: 'approval',
          message: 'Approve?',
          toolCallId: 'tc-2',
          responseSchema: { type: 'boolean' },
          expiresAt: '2030-01-01T00:00:00Z',
          metadata: { level: 'high' },
        },
      ],
    },
    usage: [
      {
        provider: 'openai',
        model: 'gpt',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        reasoningTokens: 2,
        cachedInputTokens: 1,
        cacheWriteInputTokens: 0,
      },
    ],
  },
];
