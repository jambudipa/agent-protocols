/**
 * `Accept` negotiation between the two AG-UI encodings, after the
 * `preferredMediaTypes` of `@ag-ui/encoder` 1.0.4: a media range matches by
 * type, subtype and parameters, and the offered types are ranked by quality,
 * then by how specific the matching range is, then by its position in the
 * header, then by the server's own order.
 *
 * @internal
 */
import { Array as Arr, Option, Order } from 'effect';

/** One media range of an `Accept` header. */
interface Range {
  /** The type, such as `text`, or `*`. */
  readonly type: string;
  /** The subtype, such as `event-stream`, or `*`. */
  readonly subtype: string;
  /** The parameters before `q`, with lower-case names. */
  readonly params: ReadonlyArray<readonly [string, string]>;
  /** The quality, 1 when absent. */
  readonly q: number;
  /** The position in the header. */
  readonly index: number;
}

/** How well an offered type matches the header. */
interface Priority {
  /** The quality of the best matching range; 0 means not acceptable. */
  readonly q: number;
  /** The specificity of that range: type 4, subtype 2, parameters 1. */
  readonly s: number;
  /** The position of that range in the header. */
  readonly o: number;
}

/** The shape of one media range. */
const MEDIA_RANGE = /^\s*([^\s/;]+)\/([^;\s]+)\s*(?:;(.*))?$/;

/** Removes one pair of surrounding double quotes. */
const unquote = (value: string) =>
  value.length > 1 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;

/** Parses one media range, or none when it is malformed. */
const parseRange = (text: string, index: number): Option.Option<Range> => {
  return Option.map(
    Option.fromNullishOr(MEDIA_RANGE.exec(text.trim())),
    (match) => toRange(match, index)
  );
};

/** Builds a media range from the parts that `MEDIA_RANGE` matched. */
const toRange = (match: RegExpExecArray, index: number): Range => {
  const pairs = (match[3] ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part): readonly [string, string] => {
      const at = part.indexOf('=');
      return at === -1
        ? [part.toLowerCase(), '']
        : [part.slice(0, at).toLowerCase(), unquote(part.slice(at + 1))];
    });
  const qAt = pairs.findIndex(([key]) => key === 'q');
  const q = qAt === -1 ? 1 : Number.parseFloat(pairs[qAt]?.[1] ?? '1');
  return {
    type: match[1] ?? '',
    subtype: match[2] ?? '',
    params: qAt === -1 ? pairs : pairs.slice(0, qAt),
    q: Number.isNaN(q) ? 0 : q,
    index,
  };
};

/** Parses an `Accept` header; an absent header accepts everything. */
const parseAccept = (accept: Option.Option<string>): ReadonlyArray<Range> =>
  Option.getOrElse(accept, () => '*/*')
    .split(',')
    .flatMap((text, index) => Option.toArray(parseRange(text, index)));

/** How a range matches an offered type, or none when it does not. */
const specify = (offered: Range, range: Range): Option.Option<Priority> => {
  const sameType = range.type.toLowerCase() === offered.type.toLowerCase();
  const sameSubtype =
    range.subtype.toLowerCase() === offered.subtype.toLowerCase();
  if (!sameType && range.type !== '*') return Option.none();
  if (!sameSubtype && range.subtype !== '*') return Option.none();
  const paramsMatch = range.params.every(
    ([key, value]) =>
      value === '*' ||
      value.toLowerCase() ===
        (offered.params.find(([k]) => k === key)?.[1] ?? '').toLowerCase()
  );
  if (!paramsMatch) return Option.none();
  return Option.some({
    q: range.q,
    s:
      (sameType ? 4 : 0) |
      (sameSubtype ? 2 : 0) |
      (range.params.length > 0 ? 1 : 0),
    o: range.index,
  });
};

/** The best match of an offered type against the header. */
const priority = (offered: string, ranges: ReadonlyArray<Range>): Priority => {
  const parsed = parseRange(offered, 0);
  return ranges.reduce<Priority>(
    (best, range) =>
      Option.match(
        Option.flatMap(parsed, (type) => specify(type, range)),
        {
          onNone: () => best,
          onSome: (spec) =>
            (best.s - spec.s || best.q - spec.q || best.o - spec.o) < 0
              ? spec
              : best,
        }
      ),
    { q: 0, s: 0, o: -1 }
  );
};

/**
 * The offered type that the header prefers, or none when it accepts none
 * of them. Ties keep the server's order.
 *
 * @internal
 */
export const preferredMediaType = (
  accept: Option.Option<string>,
  offered: ReadonlyArray<string>
): Option.Option<string> => {
  const ranges = parseAccept(accept);
  const ranked = Arr.sort(
    offered
      .map((type, index) => ({ type, index, ...priority(type, ranges) }))
      .filter((entry) => entry.q > 0),
    Order.make<{ q: number; s: number; o: number; index: number }>(
      (a, b) =>
        Math.sign(b.q - a.q || b.s - a.s || a.o - b.o || a.index - b.index) as
          -1 | 0 | 1
    )
  );
  return Option.map(Arr.head(ranked), (entry) => entry.type);
};
