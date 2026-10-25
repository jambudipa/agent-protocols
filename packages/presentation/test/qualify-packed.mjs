/** Native test harness: qualify installed tarball exports without checkout imports. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [tarballInput, sourceCommit, outputInput] = process.argv.slice(2);
assert(
  tarballInput && sourceCommit && outputInput,
  'Usage: node qualify-packed.mjs TARBALL FULL_SOURCE_COMMIT REPORT'
);
assert.match(sourceCommit, /^[a-f0-9]{40}$/);
const tarball = resolve(tarballInput);
const output = resolve(outputInput);
const compiler = require.resolve('typescript/bin/tsc');
const environments = [];
const wireRuntime = `
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const closure = [];
registerHooks({ resolve(specifier, context, nextResolve) {
  assert(!specifier.startsWith('effect'), 'wire must not import Effect');
  const resolved = nextResolve(specifier, context);
  if (resolved.url.includes('/@jambudipa/presentation/')) closure.push(resolved.url);
  return resolved;
}});
const wire = await import('@jambudipa/presentation/wire');
const text = { version: '1', kind: 'text', text: 'hello' };
const capabilities = { version: '1', messageKinds: ['group', 'text'] };
assert.equal(wire.isPresentationMessageV1(text), true);
assert.equal(wire.isPresentationCapabilitiesV1(capabilities), true);
assert.equal(wire.PresentationMessageV1Kinds.length, 9);
assert.deepEqual(wire.downgradePresentationMessageV1({ version: '1', kind: 'group', label: 'g', children: [text, { version: '1', kind: 'card', title: 't', body: 'b' }] }, capabilities), { version: '1', kind: 'group', label: 'g', children: [text] });
let calls = 0;
assert.equal(wire.isPresentationMessageV1({ get version() { calls += 1; return '1'; }, kind: 'text', text: 'hello' }), false);
assert.equal(calls, 0);
const cycle = []; cycle.push(cycle);
assert.equal(wire.isJsonValueV1(cycle), false);
assert(closure.length >= 2, 'trace the entire installed static closure');
console.log(JSON.stringify({ closure, exportCount: Object.keys(wire).length }));
`;
const typeSource = `
import { isPresentationRecordV1, downgradePresentationMessageV1, type PresentationRecordV1, type PresentationMessageV1, type PresentationCapabilitiesV1, type UserInteractionRequestV1 } from '@jambudipa/presentation/wire';
const request: UserInteractionRequestV1 = { version: '1', kind: 'text', requestId: 'r1', executionId: 'e1', turnId: 't1', revision: 0, createdAtEpochMs: 0, expiresAtEpochMs: 1000 };
const message: PresentationMessageV1 = { version: '1', kind: 'interaction', request };
const capabilities: PresentationCapabilitiesV1 = { version: '1', messageKinds: ['interaction'] };
const visible: PresentationMessageV1 | undefined = downgradePresentationMessageV1(message, capabilities);
const input: unknown = visible;
if (isPresentationRecordV1(input)) { const record: PresentationRecordV1 = input; void record; }
`;
const schemaRuntime = `
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import * as root from '@jambudipa/presentation';
import * as codecs from '@jambudipa/presentation/schema';
const request = { version: '1', kind: 'confirm', requestId: 'r1', executionId: 'e1', turnId: 't1', revision: 0, createdAtEpochMs: 0, expiresAtEpochMs: 1000 };
const response = { version: '1', kind: 'confirm', requestId: 'r1', executionId: 'e1', turnId: 't1', revision: 0, confirmed: true };
const text = { version: '1', kind: 'text', text: 'hello' };
const record = { version: '1', messageId: 'm1', executionId: 'e1', sequence: 1, atEpochMs: 0, message: text };
for (const [codec, value] of [
  [codecs.JsonValueV1Schema, { a: [null, 1, 'é'] }],
  [codecs.PresentationMessageV1Schema, text],
  [codecs.PresentationRecordV1Schema, record],
  [codecs.UserInteractionRequestV1Schema, request],
  [codecs.UserInteractionResponseV1Schema, response],
  [codecs.PresentationCapabilitiesV1Schema, { version: '1', messageKinds: ['text'] }]
]) {
  const decoded = Schema.decodeUnknownSync(codec)(value);
  assert.deepEqual(Schema.encodeSync(codec)(decoded), value);
}
assert.equal(Schema.is(codecs.JsonValueV1Schema)(new Date(0)), false);
assert.equal(Schema.is(codecs.PresentationMessageV1Schema)({ ...text, extra: true }), false);
assert.equal(Schema.is(codecs.PresentationMessageV1Schema)({ ...text, version: '2' }), false);
assert.deepEqual(root.validateInteractionResponseV1(request, response), { valid: true, value: true });
assert.equal(root.PresentationMessageV1Schema, codecs.PresentationMessageV1Schema);
console.log(JSON.stringify({ schemaCount: Object.keys(codecs).length }));
`;
for (const mode of ['wire', 'schema']) {
  const directory = mkdtempSync(
    join(tmpdir(), `presentation-${mode}-consumer-`)
  );
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: `presentation-${mode}-consumer`,
      private: true,
      type: 'module',
    })
  );
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--omit=peer',
      tarball,
      ...(mode === 'schema' ? ['effect@4.0.6'] : []),
    ],
    { cwd: directory, stdio: 'pipe' }
  );
  const installed = join(directory, 'node_modules/@jambudipa/presentation');
  assert(
    !existsSync(join(installed, 'src')),
    'consumer must not import raw source'
  );
  assert.equal(
    existsSync(join(directory, 'node_modules/effect')),
    mode === 'schema'
  );
  const effectTypes =
    mode === 'schema'
      ? `
import { Schema } from 'effect';
import { PresentationMessageV1Schema } from '@jambudipa/presentation/schema';
import { PresentationRecordV1Schema } from '@jambudipa/presentation';
const decoded: PresentationMessageV1 = Schema.decodeUnknownSync(PresentationMessageV1Schema)({ version: '1', kind: 'text', text: 'hello' });
const codec: Schema.Codec<PresentationRecordV1> = PresentationRecordV1Schema;
void decoded; void codec;
`
      : '';
  writeFileSync(join(directory, 'consumer.ts'), typeSource + effectTypes);
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        skipLibCheck: true,
        types: [],
        lib: ['ES2022', 'DOM'],
      },
      include: ['consumer.ts'],
    })
  );
  execFileSync(
    process.execPath,
    [compiler, '-p', join(directory, 'tsconfig.json')],
    { cwd: directory, stdio: 'pipe' }
  );
  writeFileSync(
    join(directory, 'consumer.mjs'),
    mode === 'wire' ? wireRuntime : schemaRuntime
  );
  const runtime = JSON.parse(
    execFileSync(process.execPath, ['consumer.mjs'], {
      cwd: directory,
      encoding: 'utf8',
    })
  );
  const manifest = JSON.parse(
    readFileSync(join(installed, 'package.json'), 'utf8')
  );
  assert.equal(manifest.version, '0.1.0');
  environments.push({
    mode,
    directory,
    version: manifest.version,
    effectInstalled: mode === 'schema',
    typecheck: 'passed',
    runtime: 'passed',
    ...runtime,
  });
}
const packedFiles = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .trim()
  .split('\n');
assert(packedFiles.every((file) => !file.startsWith('package/src/')));
const report = {
  package: '@jambudipa/presentation',
  version: '0.1.0',
  sourceCommit,
  tarball,
  integrity:
    'sha512-' +
    createHash('sha512').update(readFileSync(tarball)).digest('base64'),
  node: process.version,
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  typescript: require('typescript/package.json').version,
  vitest: require('vitest/package.json').version,
  effect: '4.0.6',
  upstream: JSON.parse(
    readFileSync(
      join(
        environments[0].directory,
        'node_modules/@jambudipa/presentation/upstream-sources.json'
      ),
      'utf8'
    )
  ),
  packedFiles,
  environments,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    report: output,
    integrity: report.integrity,
    environments: environments.map(({ mode, typecheck, runtime }) => ({
      mode,
      typecheck,
      runtime,
    })),
  })
);
