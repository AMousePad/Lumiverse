# HTML Islands

Self-contained styled HTML in chat messages is auto-extracted into a Shadow DOM container ("island"). This isolates card `<style>` rules from the chat UI and prevents markdown from corrupting interactive markup.

## Detection

A block-level element (`<div>`, `<section>`, `<article>`, `<aside>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<form>`, `<fieldset>`, `<figure>`, `<details>`) becomes an island when its content contains a `<style>` tag. Full HTML wrappers (`<html>`, `<body>`) containing authored styles are also isolated.

Inline styling alone does not create an island or add spacing wrappers. Authored elements keep their parent and sibling relationships.

Standalone `<style>` blocks not inside a wrapper element are extracted together with any subsequent sibling HTML, including complete document-shaped markup.

## Markdown inside widget elements

Block markdown is only re-applied when text sits directly inside block containers such as `<div>`, `<section>`, `<article>`, `<blockquote>`, `<li>`, or table cells. Text inside phrasing-only or inline containers like `<span>`, `<a>`, `<strong>`, `<em>`, `<label>`, `<button>`, headings, paragraphs, and form controls is rendered with inline markdown only, so leading `+`, `-`, `*`, or `#` stay literal instead of turning into nested lists or headings that would break the surrounding HTML.

## Opting out with `data-no-island`

Add `data-no-island` to the outer block element's opening tag to render its content inline instead of inside a shadow root:

```html
<div data-no-island>
  <style>
    .my-panel { color: red; }
  </style>
  <div class="my-panel">Inline with the rest of the message.</div>
</div>
```

Useful when content needs:

- document-level click delegation (e.g. `[data-extension-trigger]` listeners on `document`)
- CSS cascade into surrounding DOM
- access from a `MutationObserver` watching the message subtree

The attribute may appear anywhere on the opening tag, including across multiple lines. Standalone `<style>` blocks cannot be opted out directly. Wrap them in a `<div data-no-island>` if you need them inline.

!!! warning "You own scoping and safety"
    Opting out disables both style isolation and the markdown-safety wrapper. Scope your selectors with a unique class prefix to avoid collisions with the chat UI, and ensure markdown will not misinterpret your content.

## Optional card padding

Add `data-card-padding` to an existing outer element to request 12px of padding above and below its content. No extra wrapper is inserted.

```html
<div data-card-padding>Card content</div>
```

Set `--card-padding` to customize the amount:

```html
<div data-card-padding style="--card-padding: 20px">Card content</div>
```

This applies to ordinary message HTML and HTML inside islands. It sets `padding-block` on the marked element, affecting its own box and background; horizontal padding is unchanged. Other inline styles remain intact. To remove the padding, use `--card-padding: 0px` or remove the attribute from the authored content.

Existing inline-styled cards no longer receive automatic spacing. Add this attribute where spacing is wanted. The separate `--html-island-visual-bleed` setting for actual island containers is unchanged.
