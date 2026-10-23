import { expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('Apple networking validates servers without credentials, redirects, or unbounded responses', async () => {
  const root = resolve(import.meta.dir, '..');
  const cache = resolve(root, '.tmp/ios-server-probe-tests');
  mkdirSync(cache, { recursive: true });
  const executable = resolve(cache, 'server-probe-regression');
  const compiler = Bun.spawn(['xcrun', 'swiftc', '-module-cache-path', cache,
    resolve(root, 'ios/native/ios/Sources/NativeServerProbe.swift'),
    resolve(import.meta.dir, 'fixtures/ios-server-probe.swift'), '-o', executable],
    { stdout: 'pipe', stderr: 'pipe' });
  const errors = await new Response(compiler.stderr).text();
  expect(await compiler.exited, errors).toBe(0);
  const probe = Bun.spawn([executable], { stdout: 'pipe', stderr: 'pipe' });
  const [output, failure] = await Promise.all([
    new Response(probe.stdout).text(), new Response(probe.stderr).text(),
  ]);
  expect(await probe.exited, failure + output).toBe(0);
  expect(output.match(/^PASS /gm)?.length).toBe(15);
}, 60_000);
