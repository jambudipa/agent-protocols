import { Option, Schema } from 'effect';
import { describe, expect, it } from '@effect/vitest';

import { outOfBand } from './effect.js';
import { PresentationMessageV1Kinds } from '../src/messages.js';
import {
  BrowserPresentationProjection,
  PresentationCapabilitiesV1Schema,
  downgradePresentationMessageV1,
  projectBrowserPresentation,
} from '../src/presentation-projection.js';

const v = { version: '1' as const };
const text = { ...v, kind: 'text', text: 'hello' };
const card = { ...v, kind: 'card', title: 't', body: 'b' };
const group = (children: readonly unknown[]): unknown => ({
  ...v,
  kind: 'group',
  label: 'g',
  children,
});

const capabilities = (kinds: readonly string[]): unknown => ({
  version: '1',
  messageKinds: kinds,
});

/**
 * A stand-in for a host's event type. jam-flow used its `EventEnvelope`; this
 * package takes the event as a type parameter, and the projections here never
 * read its fields.
 */
type EventEnvelope = { readonly eventId: string };

/** A minimal envelope; the projections here never read its fields. */
const envelope = (): EventEnvelope => outOfBand<EventEnvelope>();

describe('PresentationCapabilitiesV1Schema', () => {
  it('decodes a capability list naming known kinds', () => {
    expect(
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)(
        capabilities(['text', 'card'])
      )
    ).toEqual({ version: '1', messageKinds: ['text', 'card'] });
  });

  it('decodes an empty capability list', () => {
    expect(
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)(
        capabilities([])
      )
    ).toMatchObject({ messageKinds: [] });
  });

  it('decodes every declared kind at once', () => {
    expect(
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)(
        capabilities([...PresentationMessageV1Kinds])
      )
    ).toMatchObject({ messageKinds: [...PresentationMessageV1Kinds] });
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)(
        capabilities(['wizard'])
      )
    ).toThrow();
  });

  it('rejects a repeated kind', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)(
        capabilities(['text', 'text'])
      )
    ).toThrow();
  });

  it('rejects the wrong version', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)({
        version: '2',
        messageKinds: ['text'],
      })
    ).toThrow();
  });

  it('rejects an unexpected extra key', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)({
        version: '1',
        messageKinds: ['text'],
        extra: 1,
      })
    ).toThrow();
  });

  it('rejects a missing key', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)({
        version: '1',
      })
    ).toThrow();
  });

  it('rejects messageKinds that is not an array', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)({
        version: '1',
        messageKinds: 'text',
      })
    ).toThrow();
  });

  it('rejects a non-object', () => {
    expect(() =>
      Schema.decodeUnknownSync(PresentationCapabilitiesV1Schema)('text')
    ).toThrow();
  });
});

describe('downgradePresentationMessageV1', () => {
  it('passes a supported message through', () => {
    expect(
      Option.getOrNull(
        downgradePresentationMessageV1(text, capabilities(['text']))
      )
    ).toEqual(text);
  });

  it('drops a message whose kind the peer does not support', () => {
    expect(
      Option.isNone(
        downgradePresentationMessageV1(card, capabilities(['text']))
      )
    ).toBe(true);
  });

  it('keeps the supported children of a group', () => {
    const downgraded = downgradePresentationMessageV1(
      group([text, card]),
      capabilities(['group', 'text'])
    );
    expect(Option.getOrNull(downgraded)).toMatchObject({
      kind: 'group',
      children: [text],
    });
  });

  it('drops a group whose every child was unsupported, rather than sending an empty one', () => {
    expect(
      Option.isNone(
        downgradePresentationMessageV1(
          group([card]),
          capabilities(['group', 'text'])
        )
      )
    ).toBe(true);
  });

  it('keeps a group that was already empty', () => {
    expect(
      Option.getOrNull(
        downgradePresentationMessageV1(group([]), capabilities(['group']))
      )
    ).toMatchObject({ kind: 'group', children: [] });
  });

  it('drops a group whose own kind is unsupported, children notwithstanding', () => {
    expect(
      Option.isNone(
        downgradePresentationMessageV1(group([text]), capabilities(['text']))
      )
    ).toBe(true);
  });

  it('downgrades a nested group', () => {
    const downgraded = downgradePresentationMessageV1(
      group([group([text, card])]),
      capabilities(['group', 'text'])
    );
    expect(Option.getOrNull(downgraded)).toMatchObject({
      children: [{ kind: 'group', children: [text] }],
    });
  });

  it('answers None for a message that is not a valid V1 message', () => {
    expect(
      Option.isNone(
        downgradePresentationMessageV1(
          { ...v, kind: 'wizard' },
          capabilities(['text'])
        )
      )
    ).toBe(true);
  });

  it('answers None for capabilities that do not validate', () => {
    expect(
      Option.isNone(
        downgradePresentationMessageV1(text, capabilities(['wizard']))
      )
    ).toBe(true);
  });

  it('answers None rather than throwing for a non-object message', () => {
    expect(
      Option.isNone(
        downgradePresentationMessageV1('hello', capabilities(['text']))
      )
    ).toBe(true);
  });
});

describe('BrowserPresentationProjection', () => {
  it('projects nothing by default, so a host must opt in', () => {
    expect(Option.isNone(BrowserPresentationProjection(envelope()))).toBe(true);
  });
});

describe('projectBrowserPresentation', () => {
  it('accepts a projection returning a valid V1 message', () => {
    expect(
      Option.getOrNull(projectBrowserPresentation(() => text, envelope()))
    ).toEqual(text);
  });

  it('silences a projection returning something outside the contract', () => {
    // None says that without a caught exception standing in for it.
    expect(
      Option.isNone(
        projectBrowserPresentation(() => ({ nonsense: true }), envelope())
      )
    ).toBe(true);
  });

  it('silences a projection that throws', () => {
    expect(
      Option.isNone(
        projectBrowserPresentation(() => {
          throw new Error('host projection blew up');
        }, envelope())
      )
    ).toBe(true);
  });

  it('silences a projection returning undefined', () => {
    expect(
      Option.isNone(projectBrowserPresentation(() => undefined, envelope()))
    ).toBe(true);
  });

  it('passes the envelope to the host projection', () => {
    const seen: unknown[] = [];
    const given = envelope();
    projectBrowserPresentation((event) => {
      seen.push(event);
      return text;
    }, given);
    expect(seen).toEqual([given]);
  });
});
