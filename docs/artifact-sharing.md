# Exact-version artefact library

An administrator explicitly shares a tested static code package with one destination project, including the same project. Members see these grants plus their own locally authorised tested versions in the project library. Local reuse resolves only same-project owned work (or administrator access), never another participant’s private work. Publication and project membership do not automatically expose another participant’s work in the library.

The administrator selects the exact version, reviews its package, chooses the destination and writes explicit approved context (up to 8,000 characters). The approved package uses existing limits: at most 500 safe relative paths and 10 MB of string file contents. Intentionally packaged assets (including SVG and embedded images) are included in the exact admin approval; private interview attachment records are never consulted. Recognizable private keys are rejected. The administrator must review all code for private material; automated detection cannot establish that arbitrary JavaScript contains no secrets. Rebuild/redact a package before sharing if needed. Do not approve chats, private images, live data, credentials or source capabilities as context.

`artifactShare` records the exact source version, source/destination projects, actor/time, approved context, active state and revision. A private destination-scoped `artifactSharePackage` stores the approved bytes. Revocation uses an expected revision and prevents new imports immediately. Deleted/archived source project, design, version or artefact and destination project are unavailable. Existing independent imports survive source removal and share revocation. Their destination project/design lifecycle still controls access.

Starting a design creates a fresh participant-owned design and interview conversation, plus immutable `artifactImport` material scoped to that destination. No native session binding, source snapshots, chat history, image attachments, brand exceptions, publication or data installations are copied. The import request has a participant-scoped idempotency key; an identical retry returns the same design even after share revocation. Changed input conflicts. Gallery and preview capabilities cannot be used for arbitrary source-version lookups.

The design keeps a visible Starting from title/version reference with its exact preview. Imports are evidence and are never participant-confirmed requirements. Every job includes bounded approved context in the existing artefact evidence envelope, including later turns and retries. Installed interview prepare v5/v6 and builder v5 (builder pipeline v6) can carry that envelope without platform changes or new grants. The builder receives the pinned import package for the first build, then prefers destination registered versions. Brand and data permissions remain destination-owned. Registration records source ancestry while attaching the new version to the destination design and artefact.

Library previews use short-lived scoped capability URLs. They serve only approved package bytes and block network calls, remote/private images, frames, forms and inherited origin privileges. Approved packaged assets and data URLs can render. The app never attaches a data SDK bridge to these frames. Existing source hardcoded bindings will therefore be unavailable. Builders must replace them with the destination SDK and report missing data setup honestly; an imported manifest is a permission request, never an installation.

API routes:

- `GET /api/projects/:id/library` lists active authorized entries.
- `POST /api/projects/:id/library/:entryId/preview` creates a short-lived preview.
- `GET/POST /api/projects/:id/artifact-shares` manages administrator grants.
- `DELETE /api/projects/:id/artifact-shares/:shareId` revokes with `expectedRevision`.
- `POST /api/projects/:id/designs` with `libraryEntryId` and `requestId` creates an independent import.

Explicit foreign `artifactVersionId` and `startingVersionId` inputs remain rejected. Only server-resolved private import material can serve as an initial foreign-derived package. New destination versions require their own testing, registration, publication and exact-version data review.

The existing native preparation budgets still apply (interview prompt 220 KB, builder evidence 200 KB). Very large packages or accumulated context may need an explicitly reported context-size reduction before building; the library package storage limit does not increase native model context budgets. External asset URLs are blocked by the reference preview; package intended static assets into the approved version.
