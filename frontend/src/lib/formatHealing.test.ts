import { describe, expect, test } from 'bun:test'
import { healFormattingArtifacts } from './formatHealing'

describe('healFormattingArtifacts', () => {
  test('closes unclosed font tags around dialogue and actions', () => {
    expect(healFormattingArtifacts('<font color="aaabbb>"Hey there." They said.'))
      .toBe('<font color="aaabbb">"Hey there."</font> They said.')
    expect(healFormattingArtifacts('<font color=xxxxxx>"Hey hey!" <font color=baabaa>*They look great today.*'))
      .toBe('<font color=xxxxxx>"Hey hey!"</font> <font color=baabaa>*They look great today.*</font>')
  })

  test('does not change balanced font tags', () => {
    const input = '<font color=#abc>"Hello."</font> <font color=#def>*She smiled.*</font>'
    expect(healFormattingArtifacts(input)).toBe(input)
  })

  test('preserves fenced code while healing surrounding prose', () => {
    const input = 'Use this exactly:\n```json\n{ "example": "* softly*" }\n```\n\nThen * softly*.'
    expect(healFormattingArtifacts(input)).toBe(
      'Use this exactly:\n```json\n{ "example": "* softly*" }\n```\n\nThen *softly*.',
    )
  })
})

test.each([
  ["complete fence", "Before \" spaced \".\n~~~lang\n\" protected \"\n~~~\nAfter \" spaced \".", "Before \"spaced\".\n~~~lang\n\" protected \"\n~~~\nAfter \"spaced\"."],
  ["shorter closing run", "~~~~lang\n\" protected \"\n~~~\n\" tail \"", "~~~~lang\n\" protected \"\n~~~\n\"tail\""],
  ["longest eligible run", "~~~~lang\n\" first \"\n~~~\n\" second \"\n~~~~\n\" tail \"", "~~~~lang\n\" first \"\n~~~\n\" second \"\n~~~~\n\"tail\""],
  ["longer closing run", "~~~lang\n\" spaced \"\n~~~~\n\" tail \"", "~~~lang\n\"spaced\"\n~~~~\n\"tail\""],
  ["adjacent fences", "~~~\n~~~\n\" spaced \"", "~~~\n~~~\n\"spaced\""],
  ["blank body line", "~~~\n\n~~~\n\" spaced \"", "~~~\n\n~~~\n\"spaced\""],
  ["indented opener", " ~~~\n\" spaced \"\n~~~", " ~~~\n\"spaced\"\n~~~"],
  ["closing whitespace", "~~~\n\" spaced \"\n~~~ ", "~~~\n\"spaced\"\n~~~ "],
  ["CRLF boundary", "~~~\r\n\" spaced \"\r\n~~~\r\n", "~~~\r\n\"spaced\"\r\n~~~\r\n"],
  ["CR boundary", "~~~\r\" spaced \"\r~~~", "~~~\r\"spaced\"\r~~~"],
  ["mixed markers", "```lang\n\" first \"\n~~~\n\" second \"\n```\n\" tail \"", "```lang\n\" first \"\n~~~\n\" second \"\n```\n\"tail\""],
  ["unclosed fence body", "~~~lang\n\" spaced \"", "~~~lang\n\"spaced\""],
])('preserves healing fences behavior for %s', (_name, input, expected) => {
  expect(healFormattingArtifacts(input)).toBe(expected)
})

test('leaves repeated unfinished fences unchanged', () => {
  const input = '```lang\nx\n'.repeat(256)
  expect(healFormattingArtifacts(input)).toBe(input)
})

test.each([
  ["ordinary inline", "Before \" spaced \". `\" protected \"` After \" spaced \".", "Before \"spaced\". `\" protected \"` After \"spaced\"."],
  ["multiline inline", "`line\n\" protected \"` Then \" spaced \".", "`line\n\" protected \"` Then \"spaced\"."],
  ["shorter closer", "````\" protected \"``` Then \" spaced \".", "````\" protected \"``` Then \"spaced\"."],
  ["longer closer remainder", "``\" first \"``` \" second \"` Then \" spaced \".", "``\" first \"``` \" second \"` Then \"spaced\"."],
  ["longest closer wins", "````\" first \"``` \" second \"```` Then \" spaced \".", "````\" first \"``` \" second \"```` Then \"spaced\"."],
  ["self close before shorter run", "``````\" spaced \"`` Then \" spaced \".", "``````\"spaced\"`` Then \"spaced\"."],
  ["odd self close remainder", "`````\" protected \"` Then \" spaced \".", "`````\" protected \"` Then \"spaced\"."],
  ["unclosed single marker", "`\" spaced \"", "`\" spaced \""],
  ["escaped markers remain matched", "\\`\" protected \"\\` Then \" spaced \".", "\\`\" protected \"\\` Then \"spaced\"."],
  ["fenced boundary", "`before\n~~~\n`\" protected \"`\n~~~\n\" spaced \"", "`before\n~~~\n`\" protected \"`\n~~~\n\"spaced\""],
])('preserves inline shielding for %s', (_name, raw, expected) => {
  expect(healFormattingArtifacts(raw)).toBe(expected)
})

test('handles a long backtick run without a later closer', () => {
  const raw = '`'.repeat(4096) + 'x'.repeat(4096)
  expect(healFormattingArtifacts(raw)).toBe(raw)
})
