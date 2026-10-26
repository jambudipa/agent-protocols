import { Option } from 'effect';
import { describe, expect, it } from '@effect/vitest';

import {
  MAX_BLOCK_BYTES,
  MAX_REQUEST_BYTES,
  RichContentError,
  assembleChunks,
  blockBytes,
  downgradeMessage,
  messageBytes,
  replaceMessage,
  validateBlock,
  validateMessage,
  type ContentBlock,
  type ContentBlockKind,
  type PresentationCapability,
  type RichMessage,
} from '../src/rich-content.js';

const block = (overrides: Partial<ContentBlock> = {}): ContentBlock => ({
  kind: 'text',
  body: 'hello',
  mimeType: Option.none(),
  annotations: [],
  ...overrides,
});

const message = (overrides: Partial<RichMessage> = {}): RichMessage => ({
  messageId: 'm1',
  role: 'agent',
  revision: 0,
  blocks: [block()],
  ...overrides,
});

const rejectionOf = (error: Option.Option<RichContentError>): string => {
  expect(Option.isSome(error)).toBe(true);
  if (Option.isNone(error)) return expect.unreachable();
  return error.value.rejection;
};

const capability = (
  supported: readonly ContentBlockKind[],
  downgradeTo?: readonly ContentBlockKind[]
): PresentationCapability => ({
  supported,
  ...(downgradeTo === undefined ? {} : { downgradeTo }),
});

describe('blockBytes and messageBytes', () => {
  it('measures a block by the UTF-8 length of its body', () => {
    expect(blockBytes(block({ body: 'abc' }))).toBe(3);
  });

  it('counts multi-byte characters by byte', () => {
    expect(blockBytes(block({ body: '名' }))).toBe(3);
  });

  it('measures an empty body as zero', () => {
    expect(blockBytes(block({ body: '' }))).toBe(0);
  });

  it('sums every block in a message', () => {
    expect(
      messageBytes(
        message({ blocks: [block({ body: 'ab' }), block({ body: 'cde' })] })
      )
    ).toBe(5);
  });

  it('measures a message with no blocks as zero', () => {
    expect(messageBytes(message({ blocks: [] }))).toBe(0);
  });
});

describe('validateBlock', () => {
  it('accepts a plain text block', () => {
    expect(Option.isNone(validateBlock('m1', block()))).toBe(true);
  });

  it('accepts an empty text block, because "the model said nothing here" is a real state', () => {
    expect(Option.isNone(validateBlock('m1', block({ body: '' })))).toBe(true);
  });

  it('rejects a block past the block size limit', () => {
    expect(
      rejectionOf(
        validateBlock('m1', block({ body: 'x'.repeat(MAX_BLOCK_BYTES + 1) }))
      )
    ).toBe('block-too-large');
  });

  it('rejects an annotation with an empty key', () => {
    expect(
      rejectionOf(
        validateBlock('m1', block({ annotations: [{ key: '', value: 'v' }] }))
      )
    ).toBe('malformed-annotation');
  });

  it('accepts an annotation with a key', () => {
    expect(
      Option.isNone(
        validateBlock('m1', block({ annotations: [{ key: 'k', value: 'v' }] }))
      )
    ).toBe(true);
  });

  it('accepts a well-formed MIME type', () => {
    expect(
      Option.isNone(
        validateBlock('m1', block({ mimeType: Option.some('text/plain') }))
      )
    ).toBe(true);
  });

  it('rejects a malformed MIME type', () => {
    expect(
      rejectionOf(
        validateBlock('m1', block({ mimeType: Option.some('not a mime') }))
      )
    ).toBe('malformed-mime');
  });

  it.each(['image', 'audio'] as const)(
    'accepts a %s block whose body is base64',
    (kind) => {
      expect(
        Option.isNone(validateBlock('m1', block({ kind, body: 'aGVsbG8=' })))
      ).toBe(true);
    }
  );

  it.each(['image', 'audio'] as const)(
    'rejects a %s block whose body is not base64',
    (kind) => {
      expect(
        rejectionOf(validateBlock('m1', block({ kind, body: 'not base64!' })))
      ).toBe('malformed-base64');
    }
  );

  it.each(['image', 'audio'] as const)(
    'rejects a %s block with an empty body',
    (kind) => {
      expect(rejectionOf(validateBlock('m1', block({ kind, body: '' })))).toBe(
        'malformed-base64'
      );
    }
  );

  it.each(['resource', 'resource-link'] as const)(
    'accepts a %s block whose body is a URI',
    (kind) => {
      expect(
        Option.isNone(
          validateBlock('m1', block({ kind, body: 'https://example.test/a' }))
        )
      ).toBe(true);
    }
  );

  it.each(['resource', 'resource-link'] as const)(
    'rejects a %s block whose body is a bare string',
    (kind) => {
      // A resource is admitted only through a host contract, and a host
      // contract needs a URI it can resolve.
      expect(
        rejectionOf(validateBlock('m1', block({ kind, body: 'just a name' })))
      ).toBe('malformed-uri');
    }
  );
});

describe('validateMessage', () => {
  it('accepts a well-formed message', () => {
    expect(Option.isNone(validateMessage(message()))).toBe(true);
  });

  it('rejects a message with no identity', () => {
    expect(rejectionOf(validateMessage(message({ messageId: '' })))).toBe(
      'missing-identity'
    );
  });

  it('propagates a block-level rejection', () => {
    expect(
      rejectionOf(
        validateMessage(
          message({ blocks: [block({ kind: 'image', body: 'nope!' })] })
        )
      )
    ).toBe('malformed-base64');
  });

  it('rejects a block kind the peer does not support', () => {
    expect(
      rejectionOf(
        validateMessage(
          message({ blocks: [block({ kind: 'image', body: 'aGk=' })] }),
          capability(['text'])
        )
      )
    ).toBe('unsupported-capability');
  });

  it('accepts a supported block kind', () => {
    expect(
      Option.isNone(validateMessage(message(), capability(['text'])))
    ).toBe(true);
  });

  it('applies no capability check when none is supplied', () => {
    expect(
      Option.isNone(
        validateMessage(
          message({ blocks: [block({ kind: 'image', body: 'aGk=' })] })
        )
      )
    ).toBe(true);
  });

  it('rejects a message past the request size limit', () => {
    const many = Array.from({ length: 2 }, () =>
      block({ body: 'x'.repeat(MAX_REQUEST_BYTES / 2 + 1) })
    );
    expect(rejectionOf(validateMessage(message({ blocks: many })))).toBe(
      'request-too-large'
    );
  });

  it('accepts a message with no blocks at all', () => {
    expect(Option.isNone(validateMessage(message({ blocks: [] })))).toBe(true);
  });
});

describe('assembleChunks', () => {
  it('leaves a message with no chunks untouched', () => {
    const original = message();
    expect(assembleChunks([original], [])[0]).toBe(original);
  });

  it('appends a chunk to its own message', () => {
    const [assembled] = assembleChunks(
      [message()],
      [{ messageId: 'm1', sequence: 1, block: block({ body: 'more' }) }]
    );
    expect(assembled?.blocks).toHaveLength(2);
    expect(assembled?.blocks[1]?.body).toBe('more');
  });

  it('orders chunks by sequence, never by arrival', () => {
    // Two messages streaming at once interleave on the wire; assembling by
    // arrival would splice one message's blocks into the other.
    const [assembled] = assembleChunks(
      [message()],
      [
        { messageId: 'm1', sequence: 2, block: block({ body: 'second' }) },
        { messageId: 'm1', sequence: 1, block: block({ body: 'first' }) },
      ]
    );
    expect(assembled?.blocks.map((entry) => entry.body)).toEqual([
      'hello',
      'first',
      'second',
    ]);
  });

  it('never routes a chunk to a message it does not name', () => {
    const [first, second] = assembleChunks(
      [message(), message({ messageId: 'm2' })],
      [{ messageId: 'm2', sequence: 1, block: block({ body: 'for m2' }) }]
    );
    expect(first?.blocks).toHaveLength(1);
    expect(second?.blocks).toHaveLength(2);
  });

  it('discards a chunk naming a message that is not present', () => {
    const [assembled] = assembleChunks(
      [message()],
      [{ messageId: 'absent', sequence: 1, block: block() }]
    );
    expect(assembled?.blocks).toHaveLength(1);
  });
});

describe('replaceMessage', () => {
  it('replaces a message of the same role', () => {
    const { messages, error } = replaceMessage(
      [message()],
      message({ blocks: [block({ body: 'rewritten' })] })
    );
    expect(Option.isNone(error)).toBe(true);
    expect(messages[0]?.blocks[0]?.body).toBe('rewritten');
  });

  it('advances the revision of the replaced message', () => {
    const { messages } = replaceMessage(
      [message({ revision: 3 })],
      message({ revision: 0 })
    );
    expect(messages[0]?.revision).toBe(4);
  });

  it('rejects a replacement for an identity that is not present', () => {
    const { messages, error } = replaceMessage(
      [message()],
      message({ messageId: 'absent' })
    );
    expect(rejectionOf(error)).toBe('unknown-message');
    expect(messages).toHaveLength(1);
  });

  it('refuses to change the role, which would rewrite who said what', () => {
    const original = [message({ role: 'agent' })];
    const { messages, error } = replaceMessage(
      original,
      message({ role: 'user' })
    );
    expect(rejectionOf(error)).toBe('incompatible-replacement');
    expect(messages).toBe(original);
  });

  it('leaves every other message untouched', () => {
    const other = message({ messageId: 'm2' });
    const { messages } = replaceMessage(
      [message(), other],
      message({ blocks: [] })
    );
    expect(messages[1]).toBe(other);
  });
});

describe('downgradeMessage', () => {
  it('passes a fully supported message through unchanged in content', () => {
    const { message: result, error } = downgradeMessage(
      message(),
      capability(['text'])
    );
    expect(Option.isNone(error)).toBe(true);
    expect(Option.getOrNull(result)?.blocks[0]?.body).toBe('hello');
  });

  it('keeps the identity and revision across a downgrade', () => {
    const original = message({ revision: 4 });
    const { message: result } = downgradeMessage(
      original,
      capability(['text'])
    );
    expect(Option.getOrNull(result)?.messageId).toBe('m1');
    expect(Option.getOrNull(result)?.revision).toBe(4);
  });

  it('downgrades an unsupported block to a declared target', () => {
    const { message: result } = downgradeMessage(
      message({ blocks: [block({ kind: 'image', body: 'aGk=' })] }),
      capability(['text'], ['text'])
    );
    expect(Option.getOrNull(result)?.blocks[0]).toMatchObject({
      kind: 'text',
      body: '[image]',
    });
  });

  it('keeps a downgraded block s annotations, so what it carried is not lost', () => {
    const { message: result } = downgradeMessage(
      message({
        blocks: [
          block({
            kind: 'image',
            body: 'aGk=',
            annotations: [{ key: 'alt', value: 'a cat' }],
          }),
        ],
      }),
      capability(['text'], ['text'])
    );
    expect(Option.getOrNull(result)?.blocks[0]?.annotations).toEqual([
      { key: 'alt', value: 'a cat' },
    ]);
  });

  it('keeps a text block s own body rather than replacing it with a marker', () => {
    const { message: result } = downgradeMessage(
      message({ blocks: [block({ kind: 'text', body: 'keep me' })] }),
      capability(['resource'], ['resource'])
    );
    expect(Option.getOrNull(result)?.blocks[0]?.body).toBe('keep me');
  });

  it('refuses rather than silently dropping a block it cannot downgrade', () => {
    // Silently removing content leaves the peer with a message that reads as
    // complete and is not.
    const { message: result, error } = downgradeMessage(
      message({ blocks: [block({ kind: 'image', body: 'aGk=' })] }),
      capability(['text'])
    );
    expect(rejectionOf(error)).toBe('downgrade-refused');
    expect(Option.isNone(result)).toBe(true);
  });

  it('refuses when the declared downgrade target is itself unsupported', () => {
    const { error } = downgradeMessage(
      message({ blocks: [block({ kind: 'image', body: 'aGk=' })] }),
      capability(['text'], ['audio'])
    );
    expect(rejectionOf(error)).toBe('downgrade-refused');
  });

  it('preserves block order across a mixed downgrade', () => {
    const { message: result } = downgradeMessage(
      message({
        blocks: [
          block({ body: 'first' }),
          block({ kind: 'image', body: 'aGk=' }),
          block({ body: 'third' }),
        ],
      }),
      capability(['text'], ['text'])
    );
    expect(Option.getOrNull(result)?.blocks.map((entry) => entry.body)).toEqual(
      ['first', '[image]', 'third']
    );
  });
});
