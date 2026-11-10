# DFSC Community Submission

The `0.2.0` resource is an **unpublished generic-host v1 candidate**.
The original BVR project still owns the adapter in
`plugins/bilibili-video-research`; a separate DFSC-only repository is not needed.
The BVR runtime and dependencies remain a separately prepared installation.
Not installing dependencies automatically does not mean dependencies are banned:
BVR uses the official MCP SDK, and its author lockfile remains authoritative.

## Marketplace Requirements

The source `dfsc.plugin.json` now declares `requirements.dfsc: "0.6.0"`.
The accepted Windows generic-host combination used DFSC main
`dcab32806645502250ba1c8efd56e153e95d657b`; the version alone is not feature
detection. Older builds with the same number may lack generic host v1,
independent configuration snapshots or launch authorization. Future versions,
native macOS plugin combinations, real billing, native ASR and old-install
upgrades are not added to the verified scope by this metadata change.

`requirements.external` lists Node.js 24+, the separate BVR runtime and its
dependencies, model access/quota, and optional Bilibili cookies. The runtime
must carry `dfscHostApiVersion: 1` and have `npm ci` completed, including
development dependencies. FFmpeg and yt-dlp normally come from those npm
dependencies; they are not additional mandatory manual installations.
Each item has a description, a credential-free HTTPS preparation link and an
explicit required/optional flag.

These fields are author declarations, not installation probes, automatic
dependency installation or model authorization. They do not replace the
launcher checks, per-call confirmation or independent configuration.
The Chinese and English user guides and the technical README describe the
same preparation and compatibility boundaries.

Maintain these fields in this source repository, then pin and synchronize the
reviewed commit into the market. Do not patch a generated market copy or
duplicate requirements in `registry.json`. The resource remains unpublished
`0.2.0`; the root runtime package version is a separate identifier.

## Verify the Candidate

```sh
npm ci
npm run build
npm test
npm run verify:dfsc-host -- --desktop-root "/absolute/path/to/candidate/desktop-for-step-code"
```

The generic-host verifier loads the actual candidate broker, Step adapter,
receipt store and mode/configuration stores from that checkout. It launches the
actual BVR MCP through the installed plugin, processes local video using FFmpeg,
and uses only fake accounts, a confirmation callback and isolated provider
responses. It checks discovery without a model request, denial, per-launch
approval reuse, provider failure without fallback, MCP cancellation reaching the
provider, account replacement, fresh overseas routing and stale independent
configuration blocking before network.

This is **not** acceptance of the native runtime launcher, production Electron
confirmation UI, real account entitlements, paid requests or installation upgrade.
Those gates require separate host/plugin combination acceptance. A broker test
callback that accepts the fixture consumer is not production provenance proof.

The original `verify-dfsc-host.mjs` shared BVR bridge verifier has been retired.
The new plugin does not read `bvr/host.json` or send a self-reported runtime PID.
Its public client/reader are pinned to DFSC
`0a03b3f80b497cad3d55531171ace8c7cb381bb3`; see the bundled provenance and MIT
license in `server/host-client/`.

Native resource discovery, install, documentation and remove/reinstall can be
checked separately against a staged runtime and the current host modules:

```sh
node scripts/verify-dfsc-plugin.mjs --desktop "/absolute/path/to/staged/Desktop" --host-modules "/absolute/path/to/candidate/Desktop/electron" --output "/absolute/path/to/a/new/verification-directory"
```

That script does not sign a generic launch. It explicitly checks that manual
startup without a launch context is refused. It does not invoke analysis tools.
Use the generic-host verifier above for real BVR MCP tools/call evidence.

### Native Source Electron Combination

After building the compatible DFSC source and staging its runtime, run:

```sh
npm run verify:dfsc-electron -- --desktop-root "/absolute/path/to/candidate/desktop-for-step-code" --output "/absolute/path/to/a/new/native-acceptance-directory"
```

This uses DFSC's existing locked Electron/Playwright installation, not new BVR
runtime dependencies. The actual marketplace IPC installs the unmodified BVR
resource; its fingerprint must match the source. The production native launcher,
broker source checks, MCP handshake, BVR/FFmpeg processing and confirmation UI
remain active. Only provider transports are instrumented to use isolated local
responses, including the agent response that selects the actual BVR tool.

The eight scenarios cover denial without repeated confirmation, per-launch
approval reuse, provider failure without fallback, pending/in-flight cancellation,
account replacement with a new approval, the actual independent settings form,
independent startup/invocation without a host account, and independent revision
changes blocking the existing process. It verifies the renderer sandbox and
credential-free IPC/history, closes only its own application and removes its
test profile. Screenshots and a redacted receipt remain in the output directory.

This is Windows source Electron evidence, not a packaged upgrade, native macOS,
real OAuth/Plan entitlement or actual Bilibili no-caption ASR acceptance. The
separate broker verifier's fixture consumer callback is not used by this script.

Historical `0.1.x` discovery, icon and legacy-bridge results do not establish
compatibility with this new declaration, configuration schema or authorization.

## Migration and Review Gates

- Installation, an old BVR opt-in, MCP enablement and Full Access are not paid
  approval. The generic host requires an explicit current mode and first-call
  per-capability approval for follow mode.
- Only the external runtime path is reused from the legacy setup. Old keys and
  mode/approval are not imported automatically. Standalone clients are unchanged.
- The candidate requires the updated external BVR runtime with
  `dfscHostApiVersion: 1`, not merely a new installed resource directory.
- The new `dfsc.host.json` and independent settings schema change the upgrade
  contract. Do not promise a one-click old-install migration before the host
  compatibility checks and migration workflow have been accepted.
- The related host PRs #215, #216, #217, #218 and #220 are merged into DFSC
  main. Their merge and the accepted Windows combination do not automatically
  update an owner's daily application or prove other builds compatible.
- Do not publish the market update or replace a daily installation as part of
  source development or isolated fixture tests.

## Prepare a Market Update

1. Review and retain the BVR source change in the original repository.
2. Verify the compatible host, external BVR runtime, installed resource and
   explicit old-configuration migration together.
3. Update the existing `bilibili-video-research` registry source commit to the
   reviewed full 40-character SHA and preserve source path
   `plugins/bilibili-video-research`. Never use a floating branch or tag.
4. Update the market-maintained guide from the candidate README. The market
   overlays that guide onto the installed technical README, so old instructions
   about default follow mode or private environment files must not survive.
5. Run `python3 scripts/sync-plugin.py --plugin bilibili-video-research`,
   `python3 scripts/validate-marketplace.py --check`, and the market test suite.
   Review the generated resource copy, native marketplace file and lock.
6. Open a separate market PR. A draft may reference an immutable source PR
   commit, but must not merge until the source is reviewed and retained.
   After squash/rebase, refresh the SHA, synchronize and verify again.

Author metadata remains in `dfsc.plugin.json`: reviewed categories, keywords,
Chinese/English guides, community tutorial and explicit external links.
Do not duplicate these into registry metadata or fabricate GitHub stars.
Do not submit `node_modules`, private environment files, cookies, tokens,
profiles or logs. Preserve both BVR and vendored DFSC MIT notices.

The existing illustrated icon is unchanged in this update. Its use does not
imply endorsement by Bilibili, StepFun or DFSC.
