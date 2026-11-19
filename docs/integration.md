# Agent integration

BYO Freedom owns its SQLite product records. Autopilot owns inference, native continuity and pipeline execution. Tower owns shared coordination. The app never reads Autopilot databases or receives Nostr/private provider keys.

## Active workflows

`pipelines/interview.v6.json` extends the native scoped interviewv5 workflow with authoritative NStack capability context for generated apps. The persistent interview session exposes only reviewed public source/image reads and approved private reference-image reads; it has no filesystem, shell, signing, publishing or unrelated MCP authority. Provider credentials remain in platform custody. The app supplies current saved design, direct edits, exact implemented version and captured storage facts as data. Earlier tool-free and nativev5 definitions remain available for existing run recovery. See [agent-storage.md](agent-storage.md) and [interview-web.md](interview-web.md).

Only participant statements, explicit confirmations and direct edits establish confirmed facts. Prior assistant suggestions remain suggestions; unsupported requirements inherited from an older snapshot are reclassified. Explicit exclusions override optional/future features. A Bitcoin theme alone never requests payments, donations or wallets. The reply-first interview v8 accepts completed conversational output independently from design saving. A valid title and design document save a hidden immutable revision; incomplete designs and revision conflicts retain the reply and a separate save status. Verified source attribution comes from host receipts, not document citation syntax. User-visible design milestones advance only after an actual tested artefact registration; see `docs/design-lifecycle.md`.

`pipelines/builder.v6.json` is a separate admin-only implementation workflow with explicit NStack SDK and current-capability guidance. The manager accepted its residual native host access: this is an operator-controlled builder, not an isolated participant execution environment. The selected snapshot and starting artifact are frozen in each app job. A dedicated stable workdir and `session.completedTurn` preserve native continuity independently from the participant interview. Later turns default to the last artifact registered in that same implementation conversation; an explicitly selected base is also supported. Native history is reference context, while the saved app snapshot and version remain authoritative.

Earlier versioned pipeline/function sources are retained for existing run recovery and audit. New grants select the newly installed reviewed definitions; never repoint old in-flight jobs.

## Explicit publication

The immutable builder definition installs `byofreedom.publish`, mapped to a hash-pinned app handler. The agent invokes it during its turn with compact `{publicationId,title,manifest:"publication.json"}` arguments. Ordinary final prose never registers an artifact.

The trusted handler derives the directory from the saved conversation ID. It rejects directory/manifest symlinks, traversal and caller-selected host paths; opens the fixed regular manifest with `O_NOFOLLOW`; checks size/file identity and title/publication correlation; and validates package bounds. The CLI explicitly supplies `sessionId`, and the platform capability client also binds the authenticated session.

The handler independently validates the actual package in a read-only, no-network Docker container with no capabilities and a restricted user. It checks HTML, inline JavaScript compilation and HTTP serving, then uses the supported platform signing custody to post correlated progress and register tested files through the app API. The app pins this public worker identity separately from human admins and accepts only the matching implementation job/run. Browser behavior still requires actual browser checks; static validation alone is insufficient.

Registration creates a private immutable artifact version. Selecting a public version is a separate admin operation. Identical file content returns the existing version. The native final response remains conversational and independent from publication receipts.

## Durable managed execution

`integration/remote-pipelines.ts` uses the supported server-to-server managed pipeline edge. Provision the installation with Autopilot's trusted `clis/wapp-pipeline-installation.ts ensure`, then register each exact definition with `clis/wapp-pipeline-grant.ts register-remote`. Grants expire within 90 days and pin installation, app, owner, HTTPS origin/callback, definition and function hashes. Different origins or changed hashes require fresh grants. An expiring session capability is never used for deployed execution.

Configure `INTERVIEW_PIPELINE_CONFIG` and `BUILDER_PIPELINE_CONFIG` with public `RemotePipelineConfig` JSON. Supply either private credential file paths or the corresponding server-only opaque `*_PIPELINE_CREDENTIAL` environment values. Startup materializes those opaque grants into mode0600 files under the persistent data directory and removes their values from the app process environment. They are execution capabilities, not signing/provider keys. Never expose them through UI, logs, source or browser storage.

Each submission sends immutable `input.job` context and a stable idempotency key. The app persists the job before dispatch and records the actual run ID and signed request receipt. Lost acceptance responses retry byte-equivalent input with the same key and the public installation/definition binding saved before the first attempt. Configuration drift stops automatic resubmission and asks an operator to restore the original binding; a replacement workflow is never launched to recover an uncertain old request. Legacy attempted requests without a saved binding require operator reconciliation before retry. Run/delivery polling is limited to the grant's own runs. Polling success is not business completion.

`POST /api/pipeline-webhook` verifies the pinned Autopilot signer, kind27235, signature, exact URL/method, freshness, exact body hash, and event/envelope/header delivery/run correlation. The app atomically applies the result with replay/delivery receipts. Exact delivery retries succeed without duplicate snapshots/versions; changed receipt content conflicts. A document changed during inference preserves the candidate as a conflict, delivers the completed reply once, and allows explicit rebase into a new job. Exhausted callback delivery can be explicitly requeued without creating a new model run.

## Runtime boundaries and limits

The native project-tool protocol reports `hostFilesystemIsolation:false`. Scoped signing/publication authority and isolated package validation do not isolate the admin native session's host filesystem. Participants therefore use tool-free inference. Do not claim that a workdir or prompt alone creates host isolation.

Generated contributions run with a sandboxed origin and no inherited Nostr/account authority or secrets. They may encounter unavailable storage/clipboard features and external-service CORS restrictions; generated apps must handle those cases honestly. This release hosts static browser contributions and multiple UTF-8 text assets. Binary raster/font assets need inline data URLs; arbitrary contribution backends need a separate reviewed runtime. See `docs/api.md` for the authoritative package limits and bearer-preview expiry.

Installing source is not activation. Keep source tests, actual Docker checks, real model turns, explicit publication receipts and hosted browser checks distinct. Platform restarts or shared-contract changes require manager coordination.


Generated apps can request scoped NStack JSON/file persistence using the supplied `context.storage` SDK and `byo-data.json` manifest. Permissions require explicit exact-version admin installation. This is a bounded data service, not arbitrary backend hosting. See `docs/nstack.md` for custody, optional managed files and activation prerequisites. Existing pipelines and grants remain immutable; new builder v5 preparation adds the scoped SDK contract.


## Participant build requests

The project workspace exposes **Build this now** to design owners as well as administrators. A participant request creates a durable linked build conversation with an explicit waiting state and no inference job. Its editable browser draft survives navigation/reload. Participants cannot enqueue implementation messages or retry implementation jobs through the API. The existing builder-v6 runtime remains operator-controlled; no new tool grant or host-execution delegation is implied by owning a design or requesting a build.

An administrator can explicitly open a participant-requested conversation and operate the existing builder there. The requester can read that conversation and its generated results. Historical admin-created conversations remain admin-private; use a separate admin conversation for private notes. Versions are still visible through the design’s existing artifact history, and generating a version does not publish it to the project website.

Automatic participant building requires a separately implemented, provisioned and verified isolated runtime. The current capability descriptor reports `participantBuildAvailable: false` and `hostFilesystemIsolation: false`; no environment flag can enable participant host execution. Scoped package publication and Docker package validation do not satisfy runtime isolation.
