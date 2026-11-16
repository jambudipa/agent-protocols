/**
 * Renders a schema failure as one line per problem, each naming the JSON
 * Pointer of the bad field, what was expected and what arrived. The wording
 * follows the reference client (`expected object, received array`), so an
 * error from this package and one from `@ag-ui/client` read alike.
 *
 * @internal
 */
import { Array as Arr, Option, Predicate, Schema, SchemaIssue } from 'effect';
import type { SchemaAST } from 'effect';

/** The default formatter, for the issues that need no special wording. */
const defaultFormat = SchemaIssue.makeFormatterDefault();

/** Reads the value at `path` inside `input`, or none when it is absent. */
const valueAt = (
  input: unknown,
  path: ReadonlyArray<PropertyKey>
): Option.Option<unknown> =>
  path.reduce<Option.Option<unknown>>(
    (node, key) =>
      Option.flatMap(node, (value) =>
        (Predicate.isObject(value) || Array.isArray(value)) && key in value
          ? Option.some((value as Record<PropertyKey, unknown>)[key])
          : Option.none()
      ),
    Option.some(input)
  );

/** Renders a path as a JSON Pointer; the root is `(root)`. */
const pointer = (path: ReadonlyArray<PropertyKey>): string =>
  path.length === 0 ? '(root)' : path.map((key) => `/${String(key)}`).join('');

/** Names what an AST accepts, in the reference client's words. */
const describe = (ast: SchemaAST.AST): string => {
  switch (ast._tag) {
    case 'Literal':
      return typeof ast.literal === 'string'
        ? `"${ast.literal}"`
        : String(ast.literal);
    case 'Objects':
      return 'object';
    case 'Arrays':
      return 'array';
    case 'String':
      return 'string';
    case 'Number':
      return 'number';
    case 'Boolean':
      return 'boolean';
    case 'Null':
      return 'null';
    case 'Union':
      return Arr.dedupe(ast.types.map(describe)).join(' | ');
    case 'Declaration':
      return 'JSON value';
    default:
      return ast._tag.toLowerCase();
  }
};

/** The longest primitive that a message quotes before it truncates. */
const MAX_QUOTED = 60;

/**
 * Names what arrived: the kind of a structure, or the value of a primitive.
 *
 * @internal
 */
export const received = (value: unknown): string => {
  if (Array.isArray(value)) return 'array';
  if (Predicate.isObject(value)) return 'object';
  if (Predicate.isString(value)) {
    const text =
      value.length > MAX_QUOTED ? `${value.slice(0, MAX_QUOTED)}…` : value;
    return `"${text}"`;
  }
  return String(value);
};

/** Flattens an issue tree into lines. */
const lines = (
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey>,
  input: unknown
): ReadonlyArray<string> => {
  const line = (message: string) => [`${pointer(path)}: ${message}`];
  const mismatch = (ast: SchemaAST.AST) =>
    line(
      `expected ${describe(ast)}, received ${Option.match(
        valueAt(input, path),
        {
          onNone: () => 'nothing',
          onSome: received,
        }
      )}`
    );
  switch (issue._tag) {
    case 'Pointer':
      return lines(issue.issue, [...path, ...issue.path], input);
    case 'Encoding':
      return lines(issue.issue, path, input);
    case 'Composite':
      return issue.issues.flatMap((inner) => lines(inner, path, input));
    case 'AnyOf':
      return issue.issues.length > 0
        ? issue.issues.flatMap((inner) => lines(inner, path, input))
        : mismatch(issue.ast);
    case 'InvalidType':
      return mismatch(issue.ast);
    case 'MissingKey':
      return line('required field is missing');
    default:
      return line(defaultFormat(issue).split('\n')[0] ?? 'invalid value');
  }
};

/** Renders a list of problems as a JSON array of strings. */
const renderLines = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.String))
);

/**
 * Formats a schema issue against the input that produced it, as a JSON
 * array of problems such as `["/delta: expected string, received 42"]`.
 * The JSON form is the one the reference client's error text takes, so a
 * conformance fixture's `errorContains` matches it.
 *
 * @internal
 */
export const formatIssue = (issue: SchemaIssue.Issue, input: unknown): string =>
  renderLines(lines(issue, [], input));
