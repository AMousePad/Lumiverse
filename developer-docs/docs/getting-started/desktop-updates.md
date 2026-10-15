# Bundled desktop updates

The bundled desktop updates as one distribution: native desktop shell, Bun
server, frontend, dependencies, and native engines. Instance data, saved
connections, and native OAuth credentials remain outside the installation.
Existing checkouts keep their separate Git update controls.

Use **Desktop Updates → Update Channel** to choose **Stable** or **Nightly**.
The installed release determines the initial channel; a saved choice takes
precedence. Desktop updates also work while connected to a remote instance.
The app checks on launch and every six hours. Checks do not download installers.
Choose **Update to <version>… → Update and restart** to download and install.

The download is signature-verified before any managed server is stopped. The
app captures whether its local server was running and whether the integrated
browser was visible, together with the local server port, immediately before installation. After installation it
restores that state once without changing launch preferences. External servers
remain owned by their terminal/service. A failed download leaves the current
server running; a failed installation attempts to restart a previously running
managed server. Remote instances are never updated by the desktop updater.

Only newer versions from the selected channel are offered. Switching from a
nightly to stable waits for a newer stable release; it does not automatically
downgrade an installation or its database. Isolated debug profiles, builds
without a release public key, and Linux launches outside an AppImage disable
in-app installation.

## Signing configuration

Generate one durable updater key pair using the desktop's Tauri CLI:

```sh
cd desktop
bun run tauri signer generate -w ~/.tauri/lumiverse-updater.key
```

Keep the private key and password backed up outside the repository. Configure
the GitHub repository with:

| GitHub setting | Value |
| --- | --- |
| Actions variable or secret `LUMIVERSE_UPDATER_PUBLIC_KEY` | Entire contents of the generated `.pub` file; the variable takes precedence if both exist |
| Actions secret `TAURI_SIGNING_PRIVATE_KEY` | Entire contents of the private key file |
| Actions secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used when generating the key, or empty for an unencrypted key |

The public key is compiled into the native desktop binary. Release jobs fail
before platform builds when the public/private key settings are missing.
Tauri signs the updater artifacts; Linux AppImages are signed again after the
existing permissions/media/Wayland finalizer repacks them. CI then verifies
every finalized signature against the configured public key before upload.
These update signatures are separate from Apple notarization and Windows
Authenticode signing. Losing the private key prevents signing updates that
existing installations will trust. See the [Tauri updater documentation](https://v2.tauri.app/plugin/updater/).

## Release cycle

**Stable:** bump the desktop version with `bun run desktop:version X.Y.Z`,
commit the four version files, and merge the release source into `main`. Push
`desktop-vX.Y.Z`, or manually run **Stable Bundled Desktop Release** to release
the version currently on `main`. The tag must match `desktop/package.json` and
its source must already be on `main`. A stable release needs a new desktop
version even if only the bundled server changed.

**Nightly:** **Nightly Bundled Desktop Release** runs daily at 05:23 UTC and
can be dispatched manually. It checks out `staging` and fingerprints shipped
sources, dependency manifests, desktop assets, and packaging policy. If the
fingerprint matches the last published nightly, the six-platform build is
skipped. Otherwise CI stamps a unique version in its temporary checkout, for
example `0.3.2-nightly.20261014.42` from a `0.3.1` stable base. This does not
commit a daily version bump back to the repository. Scheduled workflows must
be present on GitHub's default branch to run automatically.

Before the nightly workflow reaches the default branch, the existing **Build
Desktop** workflow can test the same release pipeline from `staging`:

```sh
gh workflow run desktop-build.yml --ref staging -f bundled_nightly=true
```

This calls the nightly workflow, which always checks out `staging`, and skips
the checkout-only build jobs. Nightly versions use GitHub's unique run ID so
the manual and scheduled entry points cannot assign the same release version.

Both channels call the same **Build Bundled Desktop Release** workflow. Each
of six OS/CPU targets builds the standalone server, runs the native/offline
server smoke tests, builds the desktop with that tested server included, and
uploads its signed payload to an unpublished draft release. Linux additionally
smoke-tests the finalized AppImage as another user. The publication job requires
all six signed platform fragments before making the release public or updating
the channel feed. Failed platforms leave the prior feed unchanged.

The `desktop-updates` prerelease carries two small feeds:

```text
https://github.com/prolix-oc/Lumiverse/releases/download/desktop-updates/stable.json
https://github.com/prolix-oc/Lumiverse/releases/download/desktop-updates/nightly.json
```

Each feed points to immutable versioned desktop release URLs. The updater
chooses the current OS/CPU automatically; it never uses the repository's
generic `releases/latest`, which may point to a server-only release. The private
key stays in CI secrets and updater IPC is restricted to the trusted tray.
Remote frontends and extension windows cannot select or install an update.

Rerunning failed platform jobs can replace assets only in their matching
unpublished draft. Published payloads are immutable. If publication succeeds
but uploading the small channel feed fails, rerun the failed publication job;
it validates the complete release and retries the feed without replacing
payloads. Draft releases from abandoned builds can be removed manually.
Rerunning an older publication cannot move a channel back to an older version
or replace an existing version with different source.

## Storage policy

Linux releases contain only AppImages and their signatures; no `.deb` is
built or uploaded. Windows publishes NSIS installers. macOS includes DMGs for
manual installation and app archives required by Tauri's updater. Updates
currently download the full signed payload, not a binary delta.

Large bundled release files upload directly to GitHub Releases. There are no
duplicate desktop, standalone server, or Intel native-addon Actions artifacts
in this pipeline. Feature-branch checkout-based installer artifacts expire
after three days. Desktop Rust caching retains the Cargo registry rather than
compiled target directories, with registry writes limited to default-branch
runs. Intel LanceDB caches only its finished addon, manifest, and license,
keyed by the pinned build and validation policy. Cached addons pass checksum,
architecture, version, and native database checks before packaging. The addon
cache is saved after validation, so an unrelated installer failure can retry
without repeating the native compile.

Actions dependency caches, Actions artifacts, and GitHub Release assets have
separate storage policies. Dropping `.deb` avoids duplicate installers; direct
release uploads and limited Rust caching address the other storage consumers.
GitHub currently limits individual release assets to 2 GiB and does not impose
a total release-size or bandwidth quota. See [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
and [Actions caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).
