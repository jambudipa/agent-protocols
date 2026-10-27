/**
 * Check for the documentation gate.
 *
 * The gate is the only thing standing between the repository and undocumented code, so it earns
 * a test of its own: a rule that silently stops matching would turn every later green run into a
 * false pass.
 *
 * Run with `node --test`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { auditDeclarations, auditFolder, auditMaintenance, MAINTENANCE_MARKER, runAudit } from './docs-audit.mjs';

const SOURCE = `
/** Documented. */
export function documented(): void {}

export function bare(): void {}

/** Documented. */
export class Thing {
  /** Documented. */
  kept = 1;
  missing = 2;
  /** Documented. */
  method(): void {
    const localsAreNotDeclarations = 1;
    return localsAreNotDeclarations ? undefined : undefined;
  }
}

const undocumentedConst = 3;

/** Documented. */
type Kept = string;

type Missing = number;
`;

void test('reports every undocumented declaration and nothing else', () => {
  const gaps = auditDeclarations(ts, 'sample.ts', SOURCE);
  assert.deepEqual(
    gaps.map((gap) => gap.name).sort(),
    ['Missing', 'bare', 'missing', 'undocumentedConst'],
  );
});

void test('a folder needs one non-empty README.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-audit-'));

  assert.deepEqual(auditFolder(dir), ['README.md missing or empty']);

  writeFileSync(join(dir, 'README.md'), '   \n');
  assert.deepEqual(auditFolder(dir), ['README.md missing or empty']);

  writeFileSync(join(dir, 'README.md'), 'What this folder is for.\n');
  assert.deepEqual(auditFolder(dir), []);
});

void test('the root files must carry the upkeep marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-audit-root-'));
  mkdirSync(join(root, 'src'), { recursive: true });

  assert.equal(auditMaintenance(root).length, 3);

  writeFileSync(join(root, 'README.md'), `Repo docs.\n\n${MAINTENANCE_MARKER}\nKeep them current.\n`);
  writeFileSync(join(root, 'AGENTS.md'), '@README.md\n');
  writeFileSync(join(root, 'CLAUDE.md'), 'Project notes.\n');
  assert.deepEqual(auditMaintenance(root), [
    { file: 'CLAUDE.md', reason: `no ${MAINTENANCE_MARKER} block and no README.md reference` },
  ]);

  // Root entry points that only point at README.md pass: the rule is stated once, not three times.
  writeFileSync(join(root, 'CLAUDE.md'), '@README.md\n');
  assert.deepEqual(auditMaintenance(root), []);
});

void test('an empty block does not count as documentation', () => {
  const gaps = auditDeclarations(ts, 'empty.ts', '/** */\nexport function hollow(): void {}\n');
  assert.deepEqual(gaps.map((gap) => gap.name), ['hollow']);
});

void test('a block of tags alone counts as documentation', () => {
  const source = '/** @returns nothing of interest */\nexport function tagged(): void {}\n';
  assert.deepEqual(auditDeclarations(ts, 'tags.ts', source), []);
});

void test('overload signatures need blocks; the implementation they share does not', () => {
  const source = [
    '/** Documented. */',
    'export function over(a: string): void;',
    'export function over(a: number): void;',
    'export function over(a: unknown): void {}',
  ].join('\n');
  // The second signature is undocumented; the implementation is exempt, so exactly one gap.
  assert.deepEqual(auditDeclarations(ts, 'overloads.ts', source).length, 1);
});

void test('an overload implementation inside a namespace is exempt too', () => {
  const source = [
    '/** Documented. */',
    'export namespace N {',
    '  /** Documented. */',
    '  export function over(a: string): void;',
    '  /** Documented. */',
    '  export function over(a: number): void;',
    '  export function over(a: unknown): void {}',
    '}',
  ].join('\n');
  assert.deepEqual(auditDeclarations(ts, 'namespace-overloads.ts', source), []);
});

void test('members of a dotted namespace are audited', () => {
  // `namespace A.B` nests one declaration per segment; the gate once stopped at `A` and passed.
  const source = '/** Documented. */\nnamespace A.B {\n  export const hidden = 1;\n}\n';
  assert.deepEqual(auditDeclarations(ts, 'dotted.ts', source).map((gap) => gap.name), ['hidden']);
});

void test('a run through a symlink still runs the gate', () => {
  // Node resolves the main module through symlinks; a string comparison with argv[1] once made a
  // symlinked run skip the gate entirely and exit 0.
  const dir = mkdtempSync(join(tmpdir(), 'docs-audit-link-'));
  const link = join(dir, 'docs-audit.mjs');
  symlinkSync(join(dirname(fileURLToPath(import.meta.url)), 'docs-audit.mjs'), link);
  const out = execFileSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
  assert.match(out, /^Usage:/);
});

void test('a --dir that matches nothing fails loudly instead of reporting clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-audit-dir-'));
  writeFileSync(join(root, 'real.ts'), '/** Documented. */\nexport const real = 1;\n');
  assert.throws(
    () => runAudit({ root, roots: [], dir: 'no/such/folder', kind: 'all', excludes: [], limit: 0 }),
    /matched no source files/,
  );
});

void test('an unrecognised --kind fails loudly instead of reporting clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-audit-kind-'));
  assert.throws(
    () => runAudit({ root, roots: [], kind: 'jsdocs', excludes: [], limit: 0 }),
    /is not one of/,
  );
});

void test('a repository with no JavaScript or TypeScript says so rather than passing', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-audit-empty-'));
  writeFileSync(join(root, 'main.py'), 'def f():\n    pass\n');
  assert.throws(
    () => runAudit({ root, roots: [], kind: 'all', excludes: [], limit: 0 }),
    /covers JS and TS repositories only/,
  );
});

void test('an option value is not mistaken for a scan root', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-audit-args-'));
  writeFileSync(join(root, 'real.ts'), 'export const bare = 1;\n');
  // `--exclude generated` once made "generated" the only directory scanned, so the gate reported
  // clean on a repository it never looked at.
  const report = runAudit({ root, roots: [], kind: 'folders', excludes: ['generated'], limit: 0 });
  assert.equal(report.counts.filesScanned, 1);
  assert.equal(report.counts.foldersScanned, 1);
});
