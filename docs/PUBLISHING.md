# Publishing

Releases are published to npm through GitHub Actions and npm Trusted Publishing. No npm token is stored in GitHub.

## One-time npm configuration

Configure a GitHub Actions trusted publisher for `homebridge-pitpat-treadmill` with:

- Organization or user: `Alexxanddr`
- Repository: `homebridge-pitpat-treadmill`
- Workflow filename: `release.yml`
- Environment: leave empty

The workflow path is `.github/workflows/release.yml`. npm matches the filename, repository, and owner exactly.

## Release procedure

1. Update `CHANGELOG.md`.
2. Run the complete local check:

   ```bash
   npm run check
   npm pack --dry-run
   ```

3. Create the version commit and tag:

   ```bash
   npm version patch
   git push origin master --follow-tags
   ```

   Use `minor` or `major` instead of `patch` when appropriate.

4. Create and publish the matching GitHub release, for example `v0.1.1`.
5. The `Publish to npm` workflow verifies that the release tag equals `v` plus the package version, reruns all checks, and publishes with OIDC credentials.
6. Verify the registry:

   ```bash
   npm view homebridge-pitpat-treadmill version dist-tags
   ```

Trusted Publishing automatically adds npm provenance. Draft releases do not publish until they are changed to published. Re-running a failed workflow is safe only when that version does not already exist on npm; npm versions are immutable.
