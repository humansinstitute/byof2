# Operations

BYO Freedom owns its SQLite product data. Autopilot owns agent pipelines and sessions. Tower coordinates shared records. This app requires no human or bot private key, no direct Autopilot database access, and no raw provider credential.

## Build and checks

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run build
```

Use the registered Wingman managed app runtime for local acceptance. Do not start an unrelated ad hoc server or restart Autopilot/Tower to test this app. The app supports `PORT`, `PUBLIC_ORIGIN`, `DATABASE_PATH`, and `APP_VERSION`. `/health` reports liveness; `/version` reports the configured release version. Tests using in-process `createApp` and synthetic signed keys validate protocol/data behavior and do not establish live agent or deployment acceptance.

## New CapRover installation

Use `captain-definition` and the provided Dockerfile at a new app address. Preserve the existing production site and data. The deployment manager owns target selection, remotes and final activation coordination.

Set the exact external HTTPS origin in `PUBLIC_ORIGIN`, without a trailing slash. Production fails startup if this origin is not HTTPS or contains a path. Requests are checked against this configured origin, not arbitrary forwarded headers. Set the container port to `3000` and mount a durable CapRover volume at `/app/data`; make it writable by the image's `bun` user. Keep the volume across redeployments. Do not mount a host home directory or platform data directory into the app.

Use `DATABASE_PATH=/app/data/byo.sqlite`. Keep `APP_VERSION` aligned with the reviewed release. Provision public worker/webhook signer pins and managed installation/grant configuration only through the supported broker path described in `docs/integration.md`. Opaque capabilities belong in mounted server-only files with restrictive permissions, never in images, Git, browser code or logs. Check grant expiry and exact origin/definition pins before activation. Pipeline source or passing fixture tests alone do not prove activation.

Production verification must include the deployed exact URL, health/version, NIP-98 admin/participant requests, refresh/retry preservation, an actual Mac interview with saved snapshots, an actual implementation publication, and the participant-feedback/second-version loop. Capture whether each check is local synthetic, managed local, or live hosted. Do not claim the release complete from health checks alone.

## Backups

The database uses WAL. Do not copy only the main `.sqlite` file while the app is running; committed state can still be in WAL. Use SQLite's online backup API or `.backup` to produce one consistent backup. For example, inside the app container or another authorized environment with access only to its data volume:

```sh
sqlite3 /app/data/byo.sqlite ".backup '/backup/byo-freedom.sqlite'"
sqlite3 /backup/byo-freedom.sqlite 'PRAGMA integrity_check;'
```

The runtime image does not promise a `sqlite3` CLI. If it is absent, use Bun's `bun:sqlite` database query `VACUUM INTO` with a new destination filename, or run the backup command from a dedicated operator tool container mounting the app volume and backup destination. Preserve permissions, encrypt backups at rest where available, retain independent copies, and verify restoration before relying on a backup. Backups contain private participant conversations, project membership, replay IDs and publication receipts; handle them as private app data.

An authorized Bun backup script can execute:

```ts
import { Database } from 'bun:sqlite';
const db = new Database('/app/data/byo.sqlite');
db.query('VACUUM INTO ?').run('/backup/byo-freedom-new.sqlite');
db.close();
```

The destination must not already exist. Take a fresh consistent backup before migrations or release rollback. Record the corresponding release and backup time outside Git.

## Restore and rollback

1. Obtain the deployment manager's coordination for this app's maintenance window. Stop only the BYO Freedom app process through its managed lifecycle.
2. Preserve the current data files as a recovery copy. Validate the selected backup using `PRAGMA integrity_check`.
3. Replace the app's database with the selected consistent backup, remove stale WAL/SHM companions only while this app is stopped, and restore ownership/permissions for the runtime user.
4. Start the reviewed compatible app version through the managed lifecycle. Verify `/health`, `/version`, memberships, snapshot history and publication receipts before reopening writes.
5. Reconcile any in-flight agent jobs against their exact saved request/run IDs. Do not blindly create replacement runs: a lost response can still represent accepted work.

Reverting an image does not restore data. Never delete the persistent volume during a rollback. Keep old artifact versions and immutable design snapshots; public selection can return to a prior tested version through the signed publish endpoint.

## Recovery and limitations

Queued/running/uncertain/failed work is visible in app jobs. Match retry and callback receipts to original request/run IDs. A stale design callback must be reconciled against the newer saved design instead of overwriting it. Exact publication receipts protect version creation on retries. External service CORS or availability can prevent browser integrations even when the app itself works. Contributions requiring their own backend need an explicit separate runtime decision.

Participant inference must not inherit host shell/filesystem/admin authority. Scope-limited publication brokers are not evidence of host filesystem isolation. Keep the real activated runtime's isolation evidence and any remaining limits explicit; do not replace it with prompt-only assurances.
