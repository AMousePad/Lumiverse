import { join } from 'node:path'
export { audioSmokeFixture } from './fixtures/audio-fixture'

/** Bundle the actual audio modules for a disposable page inside the native app. */
export async function nativeAudioSmokeBundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'fixtures/native-audio-smoke.ts')],
    target: 'browser', format: 'iife',
    define: { 'import.meta.env.VITE_API_BASE': '""' },
    tsconfig: join(import.meta.dir, '../frontend/tsconfig.json'),
  })
  if (!result.success) throw new AggregateError(result.logs, 'Could not bundle native audio smoke test')
  return result.outputs[0]!.text()
}

