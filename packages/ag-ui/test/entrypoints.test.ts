/**
 * The optional peers stay optional: walking the import graph of `.`,
 * `./server` and `./client` reaches neither `@effect/platform-node` nor
 * `@bufbuild/protobuf`, while `./proto` and `./node` do reach theirs.
 */
import { NodeServices } from '@effect/platform-node';
import { assert, it } from '@effect/vitest';
import { Effect, FileSystem, HashSet, Path } from 'effect';

/** The source directory, resolved from this file. */
const SRC = new URL('../src/', import.meta.url);

/** Every module specifier in a source text, static or dynamic. */
const specifiers = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]]
  );

/** The packages that an entry point loads, through every relative import. */
const packagesOf = (entry: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* path.fromFileUrl(SRC);
    let seen = HashSet.empty<string>();
    let packages = HashSet.empty<string>();
    let pending: ReadonlyArray<string> = [path.join(root, entry)];
    while (pending.length > 0) {
      const [file, ...rest] = pending;
      pending = rest;
      if (file === undefined || HashSet.has(seen, file)) continue;
      seen = HashSet.add(seen, file);
      const text = yield* fs.readFileString(file);
      for (const specifier of specifiers(text)) {
        if (specifier.startsWith('.')) {
          pending = [
            ...pending,
            path.join(path.dirname(file), specifier.replace(/\.js$/, '.ts')),
          ];
        } else {
          packages = HashSet.add(packages, specifier);
        }
      }
    }
    return [...packages];
  }).pipe(Effect.provide(NodeServices.layer));

/** Whether a package is one of the optional peers. */
const isOptionalPeer = (name: string) =>
  name.startsWith('@bufbuild/protobuf') ||
  name.startsWith('@effect/platform-node');

for (const entry of ['index.ts', 'server/index.ts', 'client/index.ts']) {
  it.effect(`${entry} loads no optional peer`, () =>
    Effect.gen(function* () {
      const packages = yield* packagesOf(entry);
      assert.include(packages, 'effect');
      assert.deepStrictEqual(packages.filter(isOptionalPeer), []);
    })
  );
}

it.effect('proto/index.ts and node.ts load their own peer', () =>
  Effect.gen(function* () {
    assert.include(yield* packagesOf('proto/index.ts'), '@bufbuild/protobuf');
    assert.include(yield* packagesOf('node.ts'), '@effect/platform-node');
  })
);
