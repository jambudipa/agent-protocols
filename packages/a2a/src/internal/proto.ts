/**
 * Schema building blocks for the ProtoJSON form of the A2A protobuf messages.
 *
 * ProtoJSON omits a field that holds its default value, so a decoder must
 * accept every key as absent. A field that the specification marks REQUIRED
 * decodes a missing key to the proto3 default and always encodes, so its type
 * is never absent. Every other field is an optional key on both sides.
 *
 * @internal
 */
import { Effect, Schema, SchemaGetter } from 'effect';

/**
 * A REQUIRED field: a missing key decodes to `value`, and the field always
 * encodes.
 *
 * @internal
 */
export const required = <S extends Schema.Constraint>(
  schema: S,
  value: S['Encoded']
) => Schema.withDecodingDefaultKey<S>(Effect.succeed(value))(schema);

/** A REQUIRED `string`. @internal */
export const requiredString = required(Schema.String, '');

/** A REQUIRED `repeated string`. @internal */
export const requiredStrings = required(Schema.Array(Schema.String), []);

/** An optional `string`. @internal */
export const optionalString = Schema.optionalKey(Schema.String);

/** An optional `repeated string`. @internal */
export const optionalStrings = Schema.optionalKey(Schema.Array(Schema.String));

/** An optional `bool`. @internal */
export const optionalBoolean = Schema.optionalKey(Schema.Boolean);

/** An `int32`. @internal */
export const Int32 = Schema.Number.check(Schema.isInt32());

/** An optional `int32`. @internal */
export const optionalInt32 = Schema.optionalKey(Int32);

/** A `google.protobuf.Struct`: a JSON object. @internal */
export const Struct = Schema.JsonObject;

/** An optional `google.protobuf.Struct`. @internal */
export const optionalStruct = Schema.optionalKey(Struct);

/** A `map<string, string>`. @internal */
export const StringMap = Schema.Record(Schema.String, Schema.String);

/**
 * RFC 3339 date-time, the ProtoJSON form of `google.protobuf.Timestamp`.
 *
 * @internal
 */
export const Timestamp = Schema.String.check(
  Schema.isPattern(
    /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/,
    { expected: 'an RFC 3339 timestamp' }
  )
).annotate({ identifier: 'Timestamp' });

/**
 * A protobuf enum. ProtoJSON writes the value name; a decoder also accepts
 * the number.
 *
 * @internal
 */
export const protoEnum = <const Names extends readonly [string, ...string[]]>(
  names: Names
) => {
  const Name = Schema.Literals(names);
  const Numeric = Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: names.length - 1 })
  );
  return Schema.Union([Name, Numeric]).pipe(
    Schema.decodeTo(Name, {
      decode: SchemaGetter.transform(
        (value: Names[number] | number): Names[number] =>
          typeof value === 'number' ? (names[value] ?? names[0]) : value
      ),
      encode: SchemaGetter.passthrough(),
    })
  );
};
