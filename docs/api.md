# BYO Freedom API

The browser and external agents use the same JSON API. Every `/api/` operation requires a freshly signed NIP-98 event; there is no cookie-only functional path. Public project sites, preview tickets, `/health`, and `/version` are outside the authenticated application API.

Send `Authorization: Nostr <base64 JSON event>`. The event must have kind `27235`, a valid Schnorr signature, a timestamp within 60 seconds, exactly one `u` tag equal to the configured public origin plus exact request path/query, and one `method` tag matching the uppercase HTTP method. Mutations and requests with bodies require a `payload` tag containing the SHA-256 of the exact transmitted UTF-8 body bytes. A signed event can be used once; event IDs are durably recorded in SQLite. Sign a new event when retrying an operation. Proxy-provided host/protocol headers do not replace the configured public URL.

The authenticated public key supplies the actor. Body owner IDs, role flags, and admin claims confer no authority. The production administrators are the exact public identities configured in `src/auth.ts`. Both administrators can read and control participant design interviews, images, edits, messages and job recovery through the same signed application routes. Ordinary participants still access only their own interviews. The snapshot-selection endpoint remains a compact selection view without interview history; administrators use the full design endpoint to read that history.

Administrative access does not transfer the design or its images to the administrator. Messages and jobs retain the actual signing actor; direct edits record `editedBy`. Foreign-design interview messages are marked as administrative interventions in model context, rather than participant confirmations. Context retains the participant owner separately. Native conversation identity remains based on the original design/conversation, so an admin intervention does not create a new agent conversation. Worker result publication, signed pipeline callbacks and exact active job/run image tickets keep their separate signer and binding requirements; an application admin cannot impersonate their issuers. Generated-app data policies and external NStack workspace permissions remain independently enforced.

| Method | Route | Access and behavior |
|---|---|---|
| GET | `/api/me` | Identity, profile, admin status, settings, integration status; applies active featured-event admission |
| PATCH | `/api/profile` | Own `{name, avatar}`; avatar must be HTTPS |
| GET | `/api/projects` | Member projects; admins see all projects and join codes |
| POST | `/api/projects` | Admin creates `{title, description}` and join code |
| POST | `/api/join` | Join using `{code}` |
| GET | `/api/settings` | Admin reads featured-event settings |
| PATCH | `/api/settings` | Admin sets `{featuredProjectId, featuredUntil}` |
| GET | `/api/projects/:id` | Project membership required; own designs and artifacts, admin implementation selections |
| PATCH | `/api/projects/:id` | Admin edits `{title, description, joinCode}` |
| GET | `/api/projects/:id/memberships` | Admin membership list |
| POST | `/api/projects/:id/designs` | Member creates own design and interview conversation; optional `{title}` |
| GET | `/api/designs/:id` | Owner/admin reads design, snapshots, interview messages, artifact history and jobs |
| GET | `/api/designs/:id/snapshots` | Owner/admin reads snapshot selection and artifact lineage, without interview messages |
| PATCH | `/api/designs/:id` | Owner/admin directly edits `{title, document, expectedSnapshotId}`; creates a hidden immutable revision within the visible design milestone, stale base returns 409 |
| POST | `/api/designs/:id/messages` | Owner/admin sends `{content, requestId, artifactVersionId?, imageIds?}`; queues interview turn |
| POST | `/api/designs/:id/implementations` | Admin creates separate chat pinned to `{snapshotId, startingVersionId?}` |
| GET | `/api/implementations/:id` | Admin reads pinned snapshot, implementation messages, artifact history and jobs |
| POST | `/api/implementations/:id/messages` | Admin queues `{content, requestId}` implementation turn |
| GET | `/api/jobs/:id` | Interview owner/admin or implementation admin reads progress/recovery state |
| POST | `/api/jobs/:id/recover` | Authorized actor checks original delivery with `{action:"check"}` or explicitly rebases a conflicted/failed interview using `{action:"rebase", requestId}` |
| POST | `/api/jobs/:id/retry` | Authorized actor retries a failed job with its original immutable input |
| POST | `/api/artifacts/:id/publish` | Admin selects `{versionId}` tested version for the public site |
| POST | `/api/pipeline-webhook` | Exact pinned Autopilot signer; signed delivery/run correlated progress or final result |
| GET | `/api/worker/jobs` | Exact configured worker signer reads queued jobs |
| GET | `/api/worker/jobs/:id/context` | Exact worker signer reads saved authoritative context |
| POST | `/api/worker/jobs/:id/progress` | Exact worker signer updates `{runId, progress}` |
| POST | `/api/worker/jobs/:id/complete` | Exact worker signer submits ordinary `{response, snapshot?}`; interview snapshot required |
| POST | `/api/worker/jobs/:id/artifacts` | Explicit publication operation; worker submits job/run-bound package and test evidence |

Responses use plain JSON objects; errors use `{ "error": "message" }` and a non-2xx status. Authentication failures return 401, authority failures 403, missing records 404, concurrency or replay conflicts 409, invalid required output 422.

Pipeline callbacks additionally require `delivery` and `run` event tags matching the `deliveryId`/`runId` envelope and `x-wingman-delivery-id`/`x-wingman-run-id` headers. A terminal successful result contains `{response, snapshot}` for interviews. The app must already have the run mapped to a durable job; an unknown run returns 409 for delivery retry. Duplicate exact delivery bodies return their original receipt; changed bodies cannot replace an accepted delivery.

Message `requestId` is an immutable caller-generated ID. A retry using a fresh signature and the same payload returns the original job; changing its payload returns 409. A conversation accepts one active turn. Publication uses `publicationId` plus exact job/run binding; a matching retry returns the original receipt/version. A conversational implementation answer alone never creates an artifact version. Every successful interview response creates exactly one hidden immutable revision atomically with its message and completion state. A direct edit during an interview prevents a stale interview callback from overwriting the edit. A signed pipeline result against a changed snapshot is acknowledged and retained as a conflict; explicit rebase creates a new job pinned to the latest snapshot, preserves the original job, and links `parentJobId`. Repeated rebase with the same request ID returns the same new job. Checking delivery never creates another turn.

Artifact publication body:

```json
{
  "publicationId": "unique-tool-invocation-id",
  "runId": "the-job-run-id",
  "title": "A useful contribution",
  "files": {
    "index.html": "<!doctype html><h1>Contribution</h1>",
    "assets/main.js": "console.log('packaged asset');"
  },
  "validation": ["Actual checks performed by the builder"]
}
```

The authoritative publication endpoint accepts at most 500 files and at most 10 MiB (10 × 1024 × 1024 UTF-8 bytes) for the serialized `files` JSON object. Every file value must be a string, and `index.html` is required. Paths must match `^[a-zA-Z0-9_./-]+$`, must not start with `/`, and must not contain a `..` path segment; filenames with spaces are currently unsupported. Packages support multiple UTF-8 HTML, JavaScript, CSS and SVG text files within these bounds. Binary raster/font files are not decoded as binary in this release; embed them as data URLs in text assets. A new explicit publication invocation containing identical file content returns the existing version with `unchanged: true`, including when the file object keys arrive in a different order. An artifact version records design ID, immutable snapshot ID, starting version ID, job/run ID, package hash and validation. Public selection is separate from generation. This first release does not offer arbitrary contribution backend hosting.

Public project index: `/sites/:projectId`. Published contribution: `/sites/:projectId/:artifactId/` includes shared project navigation and a sandboxed artifact frame. Generated package files are served under `/sites/:projectId/:artifactId/_files/`, retaining relative packaged asset paths. Private previews use short-lived opaque bearer tickets returned only by authorized API reads, expire after 15 minutes, and grant access only to that artifact package. Do not share a preview ticket unless access to its content is intended. Artifact responses enforce a sandboxed CSP without `allow-same-origin`; generated code receives no Nostr/account authority or app secrets. Browser requests to external services remain subject to those services' CORS policies.

Avatar upload is performed directly by the browser against Blossom with its own signer. The profile API stores the returned HTTPS URL; it does not fabricate or proxy an upload.

## Existing Nostr profiles

`GET /api/profile/nostr` is a signed, read-only lookup for the authenticated public key. It returns `{profile, appProfile, readOnly: true, source}`. A returned Nostr profile includes its verified kind0 event; signature, author, kind, JSON and timestamp are checked, and the newest verified event wins. The separate verified-profile cache never overwrites app-local profile data. Unavailable relays retain a previously verified profile or return an unavailable result. The app never signs or publishes kind0 events. Extension users skip the browser-nym form; `PATCH /api/profile` only changes app-local metadata.


Visible design numbers follow successful tested artefact registration, not interview turns. Snapshot APIs preserve every original immutable revision and add milestone history for the build picker. See `docs/design-lifecycle.md`. Scoped generated-app JSON/file APIs, admin-selected NStack settings, exact-version permission installation and capability limits are documented in `docs/nstack.md`; existing core data remains in SQLite.
