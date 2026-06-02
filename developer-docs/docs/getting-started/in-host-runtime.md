# In-Host Runtime

Backend extensions normally run outside the main server process. Macro interceptors, content processors, and other resolution hooks cross a host-to-worker boundary on every call. For an extension that resolves macros or transforms content on every render, that boundary can dominate the cost.

The in-host runtime lets an extension load a sanitized copy of its backend directly into the host process. Resolution then runs as direct in-process calls with no boundary crossing. It is opt-in and additive.

This is separate from [Runtime Modes](runtime.md). Runtime modes choose how the worker backend is hosted (`process`, `sandbox`, or `worker`). In-host adds an in-process binding on top of whichever mode is active.

## When to use it

When your extension does high-frequency resolution per render. A card runtime that resolves macros, regex, and templates on every message is the canonical case. If your extension only reacts to occasional events, the normal worker backend is simpler and the in-host bundle is not worth maintaining.

## How it works

1. The host reads your `host_module` bundle and runs the install-time scanner over it in strict mode.
2. On a passing scan, the host imports the bundle into its own process and binds the same registration channels (macros, interceptors, content handlers) in place.
3. Resolution calls then run in-process with no worker round-trip.
4. Your worker `entry_backend` still loads and runs as usual. If the in-host bundle is absent or fails the scan, the host uses the worker path with no change in behavior.

## Enabling it

Three things are required:

- the `dynamic_module` capability in `requested_capabilities`
- a `host_module` field pointing at the in-host bundle
- the `macro_interceptor` permission

```json
{
  "requested_capabilities": ["dynamic_module"],
  "permissions": ["macro_interceptor"],
  "host_module": "dist/host.js"
}
```

See [Backend Capabilities](capabilities.md) for `dynamic_module` and [Manifest](manifest.md) for `host_module`. The bundle can be a dedicated build, or your `entry_backend` itself if that already meets the strict-clean requirement below.

## The strict-clean requirement

The in-host bundle runs in the host process with no sandbox, so the static scanner is the only safeguard. The host scans it in **strict mode**, which means no capability suppression applies. The bundle must be interpreter-class and free of below scanned patterns, including the ones a normal `entry_backend` could declare:

- no `eval`, `Function`, `new Function`, or `.constructor`-based code generation
- no `base64` decoding
- no filesystem, subprocess, sockets, or other blocked modules

If your backend needs any of those, keep that work in the worker `entry_backend` and expose only the strict-clean resolution surface through `host_module`.

## `dynamic_module` excludes `dynamic_code_execution`

An in-host bundle must never compile code at runtime, so `dynamic_module` cannot be combined with `dynamic_code_execution`. Declaring both fails the install.
