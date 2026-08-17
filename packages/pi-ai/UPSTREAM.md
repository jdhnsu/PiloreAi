# Upstream provenance

- Upstream: `https://github.com/earendil-works/pi`
- Package: `packages/ai`
- Baseline tag: `v0.84.1`
- Baseline commit: `53fa77ccd8a279eb87e92294ef3687b03ff80112`
- Imported: 2026-08-17

PiLore maintains this package as `@pilore/pi-ai`. The package name, workspace
paths, build command, repository metadata, and dependency on the forked
telemetry package were changed during the initial fork. The generated provider
data under `src/providers/data` was copied from the matching npm release
`@earendil-works/pi-ai@0.84.1` (tarball SHA-1
`e3e6318392a9f6df6fcc9040dcfafa5e5fb779f4`) so offline builds do not query
provider registries. Upstream changes are incorporated only by an explicitly
reviewed cherry-pick or manual port.
