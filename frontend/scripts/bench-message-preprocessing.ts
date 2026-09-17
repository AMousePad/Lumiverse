import { JSDOM } from 'jsdom'
import { loadBenchmarkFunction, measureBenchmarkFixture } from './benchmark-source'

// Usage: bun scripts/bench-message-preprocessing.ts [git-ref|-] [target]
const ref = process.argv[2] === '-' ? undefined : process.argv[2]
const target = process.argv[3]
const path = 'frontend/src/components/chat/MessageContent.tsx'
const dom = new JSDOM('', { url: 'https://lumiverse.test/' })
const globals = {
  DOMParser: dom.window.DOMParser,
  window: dom.window,
  i18n: { t: () => 'Video' },
  styles: { proseDialogue: 'dialogue' },
}
const video = '<iframe src="https://www.youtube-nocookie.com/embed/abcdef?autoplay=1&amp;start=4" title="Video"></iframe>'
const cases = {
  details: {
    functionName: 'balanceStreamingDetails', normal: '<details><summary>Title</summary>\nText',
    fixtures: { missingEnds: (n: number) => '<details <summary '.repeat(n) },
  },
  embeds: {
    functionName: 'extractTrustedYouTubeEmbeds', normal: video,
    fixtures: {
      completeVideos: (n: number) => video.repeat(n),
      missingCloses: (n: number) => '<iframe '.repeat(n),
      unfinishedAfterVideo: (n: number) => video + '<iframe '.repeat(n),
    },
  },
  images: {
    functionName: 'addLazyLoadingToImages', normal: '<p>Text</p><img src="/image.png" alt="Image"><img src="/other.png" loading="eager">',
    fixtures: {
      missingEnds: (n: number) => '<!--' + '<img '.repeat(n),
      lateLoading: (n: number) => '<img '.repeat(n) + 'loading=eager>',
      completeImages: (n: number) => '<img src="/image.png">'.repeat(n),
      loadedImages: (n: number) => '<img src="/image.png" loading=eager>'.repeat(n),
    },
  },
  healingFences: {
    path: 'frontend/src/lib/formatHealing.ts',
    functionName: 'healFormattingArtifacts', normal: 'Before " spaced ".\n~~~lang\n" protected "\n~~~\nAfter " spaced ".',
    fixtures: {
      missingCloses: (n: number) => '```lang\nx\n'.repeat(n),
      completeFences: (n: number) => '~~~lang\n" protected "\n~~~\n'.repeat(n),
      longOpeningRun: (n: number) => '~'.repeat(n) + 'lang\nx\n~~~\n',
    },
  },
  healingInline: {
    path: 'frontend/src/lib/formatHealing.ts',
    functionName: 'healFormattingArtifacts', normal: 'Before " spaced ". `" protected "` After " spaced ".',
    fixtures: {
      longOpeningRun: (n: number) => '`'.repeat(n) + 'x'.repeat(n),
      completeSpans: (n: number) => 'Before `code` then " spaced ". '.repeat(n),
      shortClosers: (n: number) => '`'.repeat(n) + ('x`').repeat(n),
    },
  },
  dialogue: {
    functionName: 'colorizeDialogue', normal: '<p>"Hello," she said. Height: 5\'10&quot;.</p>',
    fixtures: {
      literalQuotes: (n: number) => '"text" '.repeat(n),
      entityQuotes: (n: number) => '&quot;text&quot; '.repeat(n),
      feetQuotes: (n: number) => '5&#39;10" '.repeat(n),
      missingTagEnds: (n: number) => '<!--' + '<'.repeat(n),
    },
  },
}
if (target && !(target in cases)) throw new Error(`Unknown benchmark target: ${target}`)
const results = []
try {
  for (const [name, group] of Object.entries(cases)) {
    if (target && target !== name) continue
    const sourcePath = 'path' in group ? group.path : path
    const run = loadBenchmarkFunction<(raw: string) => unknown>(sourcePath, group.functionName, ref, globals)
    run(group.normal)
    const fixtures: Record<string, (n: number) => string> = { normal: () => group.normal, ...group.fixtures }
    for (const [fixture, makeInput] of Object.entries(fixtures)) {
      const iterations = fixture === 'normal' ? (name === 'embeds' ? 10 : 100) : 1
      const sizes = fixture === 'normal' ? [1] : name === 'healingSpans' ? [8, 16, 32, 64, 128, 256, 512] : undefined
      const rows = measureBenchmarkFixture(run, makeInput, iterations, sizes)
      results.push(...rows.map(row => ({ target: name, fixture, ...row })))
    }
  }
} finally {
  dom.window.close()
}
console.log(JSON.stringify({ ref: ref ?? 'working tree', bun: Bun.version,
  method: 'Actual source helpers; one normal-input warmup and up to three samples per input. Normal inputs use batches; adversarial inputs double from 128 to 8192, or 8 to 512 for color spans. Stop a fixture after a batch exceeds 250 ms or total measured time exceeds 1000 ms. Limits are checked between calls. Includes real DOMParser and trusted URL validation for videos; excludes AST loading, DOM setup, layout and paint.',
  results }, null, 2))
