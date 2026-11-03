# DFSC community submission draft

This is a marketplace submission candidate, not a published marketplace entry.
The BVR server remains a standard MCP. The DFSC-specific resources live in
`plugins/bilibili-video-research`; no private configuration is vendored.

## Verify locally

With BVR dependencies installed:

```sh
npm run build
npm test
node scripts/verify-dfsc-plugin.mjs --desktop "/absolute/path/to/staged/Desktop" --output "/absolute/path/to/a/new/verification-directory"
node scripts/verify-dfsc-host.mjs --bridge-module "/absolute/path/to/compiled/DFSC/bvr-bridge.mjs" --output "/absolute/path/to/a/new/host-verification-directory"
```

The integration script needs DFSC's staged `runtime/`, including the native
management exports. It creates an isolated profile and local preview market,
installs the plugin through DFSC's actual capability manager, checks the icon,
skill and `/bvr` resource loader, and completes MCP initialization and tool
listing against the real local BVR process. It then uninstalls and reinstalls
the resource, verifying that private path configuration survives.

The verified Windows host is DFSC main `fb4828b`, staged with upstream runtime
`81e79bc4b699148d6823fedde9b5e70d9a80255f` and its declared desktop overlays.
The plugin needs the host to anchor relative MCP arguments to the plugin root.
Earlier released installers and macOS/Linux have not been tested; a shared
`0.6.0` package version alone is not a compatibility guarantee.

The first script explicitly tests independent mode on that existing host. Follow
DFSC mode additionally requires the new `Desktop/electron/bvr-bridge.ts` host
integration; it does not work just because plugin discovery works. Compile that
module to ESM for the second script, which exercises the real BVR launcher, MCP
tools/call and local FFmpeg against the actual bridge code. Its resident session,
native confirmation and provider responses are fixtures, not real account/media
acceptance. Both modes remain unpublished pending separate review.

It uses a deliberately invalid fixture key, never calls an analysis tool and
does not verify provider billing, account access, video downloads or media
quality. The fixture profile is **not** ready for paid analysis. The generated
`bvr-local-preview` market contains only distributable plugin resources; it
can be added manually to a disposable DFSC instance. Do not treat the fixture
profile or environment file as distributable resources.

## Prepare the marketplace PR

After the BVR changes have been reviewed and committed, add an entry like this
to the `plugins` array in the community market's `registry.json`:

```json
{
  "id": "bilibili-video-research",
  "description": "Bilibili video research: MCP launcher, research skill and /bvr. Requires an external BVR runtime and explicit provider configuration.",
  "source": {
    "repository": "7oMB2006/Bilibili-Video-Research",
    "commit": "<replace-with-the-reviewed-full-40-character-commit-SHA>",
    "path": "plugins/bilibili-video-research"
  },
  "license": "MIT",
  "readme": "docs/plugins/bilibili-video-research.md"
}
```

Use a real immutable SHA, not this placeholder or a floating branch/tag.
Copy/adapt the plugin README into that market-maintained guide, preserving the
companion-runtime requirement, permission/data disclosure and billing boundary.
The market overlays its reviewed guide onto the installed resource README.

From the community-market checkout, after reviewing the pinned source:

```sh
python3 scripts/sync-plugin.py --plugin bilibili-video-research
python3 scripts/validate-marketplace.py --check
python3 -m unittest discover -s tests -v
```

The sync step generates `plugins/bilibili-video-research/`,
`registry.lock.json` and `.step-plugin/marketplace.json`. Do not hand-edit hashes
or generated resources to bypass source review. Submission is a separate PR,
not something the local verification script performs.

Verify that generated market copy, rather than a second source-directory copy:

```sh
node scripts/verify-dfsc-plugin.mjs --desktop "/absolute/path/to/staged/Desktop" --output "/absolute/path/to/a/new/market-verification-directory" --marketplace "/absolute/path/to/dfsc-community-plugins" --marketplace-name dfsc-community
```

The marketplace directory must have a basename without spaces for the current
DFSC native local-source parser. This check installs from that market through the
real native manager, loads its skill and command, initializes the actual BVR MCP,
and verifies remove/reinstall without requesting a model.

## Review and availability gates

The BVR source PR and the community-market PR can be reviewed together. A draft
market PR may pin the source PR's immutable commit, but must not be merged until
that source is reviewed and retained in BVR. After a squash/rebase merge, update
the pin to the retained commit and rerun synchronization and verification.
Further resource changes likewise require a new source commit and lock refresh;
editing a branch alone never upgrades the pinned market copy.

The graphical configuration and Follow DFSC mode additionally depend on the
separate DFSC host PR. They are not features of every released 0.6.0 installer.
Until that host is available, keep the marketplace submission in draft rather
than presenting the default hosted setup as ready for general users.
Independent mode requires explicit private configuration and a tested native
plugin-relative working directory; unsupported hosts must not silently fall
back to another account, provider or billing route.

The 2026-11-04 source validation passes type checking and all 42 tests.
These are local checks, not cloud CI or real-account/media/billing acceptance.
No dependency installation, external runtime, personal profile or credential
file is included in the market resource.

This directory intentionally uses `provider.example`, not `.env.example`:
the current community validator excludes `.env` and `.env.*` resources.
Runtime dependencies and media binaries are not bundled into the market.
The MIT license covers this project's code and resource text; the existing
Bilibili logo remains a third-party identifier, not an endorsement or a claim
of ownership over that mark.
