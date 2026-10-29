# Nightly release notifications

The desktop completion workflow announces a nightly in Discord only after the
signed release and its update feed publish. The private Lumiverse-Builds Android
workflow announces its nightly only after the verified APK and supporting assets
upload and the public prerelease publishes.

Set the Actions secret `DISCORD_NIGHTLY_WEBHOOK_URL` in both `prolix-oc/Lumiverse`
and `prolix-oc/Lumiverse-Builds`. The URL is passed only to the notification step.
There is no notification for stable releases, unchanged-source skips, drafts,
failed builds, or Android toolchain-only runs. Desktop calls the notifier directly
because publication with `GITHUB_TOKEN` does not trigger another release workflow.

Messages include a versioned release link and direct links to the installers
actually present in the published assets:

- Windows: x64 and ARM64 NSIS installers.
- Linux: x64 and ARM64 AppImages.
- macOS: Apple Silicon and Intel DMGs.
- Android: ARM64 APK (Android 10 or newer).

The shared notifier is also copied into Lumiverse-Builds, with the same tests.
Updater metadata, signatures, checksums and provenance files are not listed as
installers. Messages disable mentions and wait for Discord's delivery response.
Rate limits retry up to three attempts, with a maximum 30-second wait per retry.
Transport errors never print the webhook URL or Discord response body.

A successful notification appends a hidden receipt to the release body. Serialized
desktop callbacks and reruns use it to skip duplicate delivery. If Discord accepts
the message but saving the receipt fails, a retry can still post twice; the two
services do not share a transaction. Notification errors appear in Actions but do
not fail or roll back an already published release.

To retry just a failed announcement, run `scripts/notify-nightly-release.ts`
with `desktop` or `android` and the published release tag. Set `GITHUB_TOKEN`
(Contents read/write on the release repository), `RELEASE_REPOSITORY` and
`DISCORD_NIGHTLY_WEBHOOK_URL` through a secure environment. This does not build
or publish a release. Keep webhook values out of source, logs and shell arguments.
