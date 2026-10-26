/**
 * Rich Content — role-aware messages with stable identities, ordered blocks, chunk assembly,
 * replacement, and declared downgrade rules.
 *
 * This module sits beside the existing V1 presentation contract rather than reshaping it. V1
 * describes what a browser renderer receives; this describes what a host exchanges with a
 * peer, which needs identities stable enough to replace and chunks that can arrive out of
 * order. Merging the two would force one of them to carry the other's concerns.
 *
 * Everything is validated at the boundary. A block that fails decoding must never reach a
 * Goal or a model: by then it has already been trusted.
 */

import { Chunk, Data, Option } from 'effect';
import { absurd } from 'effect/Function';

import { utf8Bytes } from './utf8.js';

/** Who produced a message. `thought` is agent reasoning, shown differently from an answer. */
export type ContentRole = 'user' | 'agent' | 'thought';

/** The block kinds a host may exchange. */
export type ContentBlockKind =
  'text' | 'image' | 'audio' | 'resource' | 'resource-link';

/** Largest single content block. Matches the approved host block limit. */
export const MAX_BLOCK_BYTES = 16 * 1024 * 1024;

/** Largest single request across all its blocks. Matches the approved host request limit. */
export const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

/** An annotation carried alongside a block. */
export interface ContentAnnotation {
  /** Non-empty — `validateBlock` refuses an annotation with no key, since nothing could read it. */
  readonly key: string;
  /** Free text. Unvalidated and uninterpreted here; meaning belongs to whoever set the key. */
  readonly value: string;
}

/** One block of content. */
export interface ContentBlock {
  /** Decides how `body` is read and which validation it must pass. */
  readonly kind: ContentBlockKind;
  /** Text for `text`; base64 for `image` and `audio`; a URI for `resource` and `resource-link`. */
  readonly body: string;
  /**
   * `None` means the sender stated no type, which is always allowed. When present it must
   * match `type/subtype`; a downgrade drops it, because the downgraded body is no longer of
   * the type the original declared.
   */
  readonly mimeType: Option.Option<string>;
  /** Survives a downgrade, so what a block carried is not lost along with its kind. */
  readonly annotations: readonly ContentAnnotation[];
}

/** One message, stable enough to be replaced and to receive chunks. */
export interface RichMessage {
  /**
   * Non-empty, and the only thing a chunk or a replacement targets. Two live messages must not
   * share one: `assembleChunks` and `replaceMessage` would then act on whichever came first.
   */
  readonly messageId: string;
  /** Fixed for the life of the message. A replacement carrying a different role is refused. */
  readonly role: ContentRole;
  /** In render order. Chunks append to the end; a replacement supplies the whole list. */
  readonly blocks: readonly ContentBlock[];
  /** Increments on replacement, so a late replacement can be recognised as stale. */
  readonly revision: number;
}

/** Why content was refused. */
export type ContentRejection =
  | 'missing-identity'
  | 'malformed-mime'
  | 'malformed-uri'
  | 'malformed-base64'
  | 'malformed-annotation'
  | 'block-too-large'
  | 'request-too-large'
  | 'unsupported-capability'
  | 'unknown-message'
  | 'incompatible-replacement'
  | 'downgrade-refused';

/** A typed content refusal naming the message and the reason. */
export class RichContentError extends Data.TaggedError('RichContentError')<{
  readonly rejection: ContentRejection;
  readonly messageId: string;
  readonly detail: Option.Option<string>;
}> {
  /** Names the message, so a log line identifies the offender without unpacking the fields. */
  override get message(): string {
    return `content for '${this.messageId}' refused: ${this.rejection}${Option.match(
      this.detail,
      { onNone: () => '', onSome: (detail) => ` (${detail})` }
    )}`;
  }
}

/** What a peer declares it can render. An absent kind is unsupported, not unknown. */
export interface PresentationCapability {
  /**
   * Exactly what the peer renders. An empty list means it renders nothing, which is a real
   * declaration — `validateMessage` then refuses every block rather than assuming a default.
   */
  readonly supported: readonly ContentBlockKind[];
  /** Kinds this peer accepts as a downgrade target, in preference order. */
  readonly downgradeTo?: readonly ContentBlockKind[];
}

/**
 * `type/subtype` in the RFC 6838 token characters.
 *
 * Shape only: it says nothing about whether the type exists or matches the body. That is a
 * deliberate limit — this boundary cannot decode every media type, and a check it could not
 * complete would read as a guarantee it does not make.
 */
const MIME_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;
/**
 * Standard base64 alphabet with optional padding.
 *
 * Accepts a length that is not a multiple of four, so it catches a body that is plainly not
 * base64 without claiming the payload decodes. `validateBlock` requires a non-empty body
 * separately, because this pattern matches the empty string.
 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;

/**
 * The single constructor for every refusal in this module.
 *
 * It keeps the `Option` wrapping of an optional detail in one place, so no call site can build
 * an error whose detail is the string `"undefined"`.
 */
const fail = (
  rejection: ContentRejection,
  messageId: string,
  detail?: string
): RichContentError =>
  new RichContentError({
    rejection,
    messageId,
    detail: Option.fromNullishOr(detail),
  });

/** Byte size of one block, measured on its encoded body. */
export const blockBytes = (block: ContentBlock): number =>
  utf8Bytes(block.body);

/** Total encoded size of a message's blocks. */
export const messageBytes = (message: RichMessage): number =>
  message.blocks.reduce((total, block) => total + blockBytes(block), 0);

/**
 * Validates one block at the boundary.
 *
 * An empty `text` block is allowed on purpose: "the model said nothing here" is a real state,
 * distinct from "there was no block". Every other kind needs a body.
 */
export const validateBlock = (
  messageId: string,
  block: ContentBlock
): Option.Option<RichContentError> => {
  const size = blockBytes(block);
  if (size > MAX_BLOCK_BYTES) {
    return Option.some(
      fail(
        'block-too-large',
        messageId,
        `${size} bytes exceeds ${MAX_BLOCK_BYTES}`
      )
    );
  }

  for (const annotation of block.annotations) {
    if (annotation.key.length === 0) {
      return Option.some(
        fail('malformed-annotation', messageId, 'an annotation has no key')
      );
    }
  }

  if (
    Option.isSome(block.mimeType) &&
    !MIME_PATTERN.test(block.mimeType.value)
  ) {
    return Option.some(
      fail(
        'malformed-mime',
        messageId,
        `'${block.mimeType.value}' is not a MIME type`
      )
    );
  }

  // Exhaustive over `ContentBlockKind`. A sixth kind is a compile error here rather than one
  // whose body is admitted unchecked, because neither condition above named it.
  switch (block.kind) {
    case 'image':
    case 'audio':
      if (block.body.length === 0 || !BASE64_PATTERN.test(block.body)) {
        return Option.some(
          fail(
            'malformed-base64',
            messageId,
            `${block.kind} body is not base64`
          )
        );
      }
      break;
    case 'resource':
    case 'resource-link':
      // A resource is admitted only through a host contract, and a host contract needs a URI it
      // can resolve. A bare string is not one.
      if (!URL.canParse(block.body)) {
        return Option.some(
          fail('malformed-uri', messageId, `'${block.body}' is not a URI`)
        );
      }
      break;
    case 'text':
      // Any UTF-8 string is a legal text body. The size and annotation checks above are the
      // whole of what this kind has to satisfy.
      break;
    default: {
      // Unreachable while the union is closed. `absurd` turns a forged kind into a defect: a
      // synchronous function has no error channel to die into.
      const unclassified: never = block.kind;
      return absurd(unclassified);
    }
  }

  return Option.none();
};

/** Validates a whole message, including its request-level size. */
export const validateMessage = (
  message: RichMessage,
  capability?: PresentationCapability
): Option.Option<RichContentError> => {
  const presentationCapability = Option.fromNullishOr(capability);
  if (message.messageId.length === 0) {
    return Option.some(
      fail('missing-identity', '<unnamed>', 'the message has no identity')
    );
  }

  for (const block of message.blocks) {
    if (
      Option.isSome(presentationCapability) &&
      !presentationCapability.value.supported.includes(block.kind)
    ) {
      return Option.some(
        fail(
          'unsupported-capability',
          message.messageId,
          `'${block.kind}' is not supported`
        )
      );
    }
    const invalid = validateBlock(message.messageId, block);
    if (Option.isSome(invalid)) return invalid;
  }

  const total = messageBytes(message);
  if (total > MAX_REQUEST_BYTES) {
    return Option.some(
      fail(
        'request-too-large',
        message.messageId,
        `${total} bytes exceeds ${MAX_REQUEST_BYTES}`
      )
    );
  }

  return Option.none();
};

/** One chunk of a message, targeted by stable identity. */
export interface ContentChunk {
  /**
   * Which message this block belongs to. A chunk naming a message that is not present is
   * DISCARDED without error — the sender may be ahead of the receiver, and refusing would turn
   * ordinary stream skew into a failure.
   */
  readonly messageId: string;
  /** Orders the chunk within its own message. Arrival order is never used. */
  readonly sequence: number;
  /** Appended after the message's existing blocks. `assembleChunks` does not validate it. */
  readonly block: ContentBlock;
}

/**
 * Assembles chunks into their matching messages.
 *
 * Chunks are grouped by `messageId` and ordered by `sequence`, never by arrival. Two messages
 * streaming at once interleave on the wire, and assembling by arrival order would splice one
 * message's blocks into the other.
 */
export const assembleChunks = (
  messages: readonly RichMessage[],
  chunks: readonly ContentChunk[]
): readonly RichMessage[] =>
  messages.map((message) => {
    const mine = chunks
      .filter((chunk) => chunk.messageId === message.messageId)
      .sort((left, right) => left.sequence - right.sequence);

    return mine.length === 0
      ? message
      : {
          ...message,
          blocks: [...message.blocks, ...mine.map((chunk) => chunk.block)],
        };
  });

/**
 * Replaces an existing message.
 *
 * Replacement requires an existing identity AND a matching role. A replacement that could
 * change the role would let an agent message be rewritten as a user message, which rewrites
 * the record of who said what.
 */
export const replaceMessage = (
  messages: readonly RichMessage[],
  replacement: RichMessage
): {
  readonly messages: readonly RichMessage[];
  readonly error: Option.Option<RichContentError>;
} => {
  const index = messages.findIndex(
    (message) => message.messageId === replacement.messageId
  );
  if (index === -1) {
    return {
      messages,
      error: Option.some(
        fail(
          'unknown-message',
          replacement.messageId,
          'no message with that identity'
        )
      ),
    };
  }

  const existing = messages[index]!;
  if (existing.role !== replacement.role) {
    return {
      messages,
      error: Option.some(
        fail(
          'incompatible-replacement',
          replacement.messageId,
          `cannot replace a '${existing.role}' message with a '${replacement.role}' one`
        )
      ),
    };
  }

  const next = messages.map((message, position) =>
    position === index
      ? { ...replacement, revision: existing.revision + 1 }
      : message
  );
  return { messages: next, error: Option.none() };
};

/**
 * Projects content for a peer with reduced support.
 *
 * Identity and order survive a downgrade. A block that cannot be downgraded fails explicitly
 * rather than being dropped — silently removing content leaves the peer with a message that
 * reads as complete and is not.
 */
export const downgradeMessage = (
  message: RichMessage,
  capability: PresentationCapability
): {
  readonly message: Option.Option<RichMessage>;
  readonly error: Option.Option<RichContentError>;
} => {
  let blocks = Chunk.empty<ContentBlock>();

  for (const block of message.blocks) {
    if (capability.supported.includes(block.kind)) {
      blocks = Chunk.append(blocks, block);
      continue;
    }

    const target = Option.fromNullishOr(
      (capability.downgradeTo ?? []).find((kind) =>
        capability.supported.includes(kind)
      )
    );
    if (Option.isNone(target)) {
      return {
        message: Option.none(),
        error: Option.some(
          fail(
            'downgrade-refused',
            message.messageId,
            `'${block.kind}' is unsupported and no downgrade target is declared`
          )
        ),
      };
    }

    // The downgraded block keeps its annotations, so what the original carried is not lost
    // along with its kind.
    blocks = Chunk.append(blocks, {
      kind: target.value,
      body: block.kind === 'text' ? block.body : `[${block.kind}]`,
      mimeType: Option.none(),
      annotations: block.annotations,
    });
  }

  return {
    // Same identity, same order, same revision.
    message: Option.some({ ...message, blocks: Chunk.toReadonlyArray(blocks) }),
    error: Option.none(),
  };
};
