# Scoped native interviews

Interview v5 uses a real Claude SDK session with two scoped web/image tools. It requires Autopilot's reviewed `session.scopedInterviewTurn.v1` builtin and `scoped-interview` execution profile. Existing interview v4 remains the tool-free fallback configuration until an operator installs, grants and verifies v5. Do not activate v5 on an older runtime or route participants through the ordinary host-native launcher.

The native profile disables built-in tools, inherited skills/settings/plugins, arbitrary MCP and Wingman broker access. Only approved public-source IDs and exact participant image IDs reach the web/image tools. The model receives actual page text or native image bytes. Source observations remain separate from participant-confirmed needs, assumptions and open questions. Page instructions are inert evidence. Successful public-source observations cite the actual final fetched URL; links retained elsewhere in an existing design do not establish that a page was inspected.

The runtime is a tool-authority boundary. It does not claim to be an operating-system sandbox for the SDK subprocess, which still needs managed model authentication and private session continuity. No filesystem, shell, publishing or general broker tool is exposed to the interview model. Web access is bounded public HTTPS text/images, with IP-pinned TLS and separately validated redirects; no login, browser JavaScript or general search is provided.

## Pipeline and response contract

Install these new versions without overwriting earlier definitions/functions:

- `pipelines/interview.v5.json`: prepare, actual native scoped turn, validate complete cited design.
- `byofreedom.prepareInterview.v5`: preserves roles, current saved design/direct edits, pinned project brand and implemented-version feedback; supplies approved source IDs and compact image metadata.
- `byofreedom.finishInterview.v4`: requires successful scoped native completion and exactly `{title, document, response}`. The document contains `Confirmed facts`, `Source observations`, `Assumptions`, and `Open questions` Markdown sections. It validates source citations against successful host receipts and returns the existing snapshot/callback shape.

The scoped turn uses a new conversation generation (`byofreedom:interview:scoped-v1:<conversation-id>`). It never upgrades an older unrestricted native binding. Native completion, idempotency, signed callbacks and saved design revision conflicts retain their existing semantics. An interview never creates or publishes an artefact; it continues the same visible design and milestone history.

Followups receive a bounded, deduplicated list of prior public-source receipts from this conversation's completed scoped jobs. These app-pinned receipts preserve earlier source observations and canonical citations, labelled with their prior observation date, without forcing another fetch. Participant-added links and earlier assistant claims cannot enter this trusted receipt list. New receipts and prior observations remain separate; a preference-only turn must not claim a fresh source check.

## Private image inputs

Both `INTERVIEW_PIPELINE_CONFIG` and `INTERVIEW_WORKFLOW_VERSION=interview-v5` must be configured, and `INTERVIEW_SCOPED_TOOLS=1` must be explicitly enabled after native runtime acceptance. Otherwise image uploads and image-bearing messages are rejected, and the composer does not advertise image inspection. `/api/me` reports `integration.interviewImages`.

Images retain participant/design ownership. Signed application administrators can upload, view and reference images in any design; an administrative upload records `uploadedBy` without changing its participant owner, so the participant can still view the image. Other participants cannot read it or reference it across designs. The browser accepts PNG, JPEG and WebP, decodes and re-encodes their visual pixels, strips metadata, and resizes the longest edge to at most 2048 pixels. WebP becomes PNG. The private server admits PNG/JPEG up to 2 MiB each, validates signatures and dimensions, stores immutable SHA-256/type/size metadata, and limits each design to 32 MiB. A message can reference two images. SVG/GIF and active content are not accepted. The admitted normalized bytes are the authoritative image evidence.

- `POST /api/designs/:designId/images`, NIP-98 signed `{name, mimeType, base64}`, stages one private image and returns metadata only. Identical bytes reuse the existing image ID.
- `GET /api/designs/:designId/images/:imageId`, owner/admin-signed, returns the stored image for the private viewer. It is not an anonymous/public link.
- `POST /api/designs/:designId/messages`, signed `{content, requestId, imageIds?}`, pins exact image IDs to the saved user message and job. Text may be empty only when at least one valid image is attached. Image-only messages retain genuinely empty participant text.

The browser keeps staged image IDs and message request identity across refreshes/send failures. It clears the draft only after successful message acceptance. Message metadata supports authenticated viewing after submission. Stored bytes and read tickets do not enter local draft storage or the native model prompt.

## Exact job/run image access

The pipeline receives compact metadata `{id, mimeType, sha256, bytes}` and a read-only `attachmentSource` containing an exact HTTPS URL, job ID, opaque 256-bit ticket and expiry. It receives no multi-megabyte image JSON or participant signing/storage credentials. The ticket is redacted from pipeline evidence by the scoped runtime.

The host tool alone reads `GET /api/interview-job-images/:jobId` with fixed headers `x-byo-image-ticket`, `x-wingman-run-id`, and `x-byo-image-id`. The platform derives the enclosing run ID and allowed client origin from trusted run/grant state. It must not accept these bindings from participant or model input. The app checks ticket hash, expiry, exact active job/run, owner/design, message and pinned image ID. Successful response is raw image bytes. Missing registered run returns 409 for a bounded dispatch-race retry; invalid authority returns 403. No redirects or general authenticated HTTP capability are granted.

Ticket lifetime is ten minutes. For a delayed queued request, the app activates fresh image access in the first-dispatch transaction, before any remote submission, only when there has never been a dispatch attempt or accepted run. After an attempt, ticket/context are immutable: lost-acceptance retries submit the same request. Known failed jobs with expired image access require explicit **Rebase interview**, which preserves image IDs and current design intent in a new job/ticket. The original prompt is never automatically resent because an image ticket expired. Completed or superseded jobs cannot use the ticket.

## Validation and activation

Run `bun run check`, `bun test`, `bun run build`, and `bun integration/interview-images-browser.ts` (Chrome installed). The browser harness uses owned local fixtures and real signatures, normalization, upload, refresh, failed-send/retry and private viewing; it does not claim native model acceptance.

Before activation, independently review the platform's real SDK tool/image/completion/resume proof and compatibility checks for older grants. Install versioned functions/definition and issue an exact definition/composition grant. A platform restart requires separate explicit operator approval. Verify an owned hosted interview actually fetches public sources and inspects image bytes, cites correct final URLs, saves the complete design and preserves edits/brand/milestones. Verify image-only input and signed result delivery without build/publish side effects. Source tests alone do not establish hosted readiness.

## Compact composer and private NStack image uploads

Paste PNG/JPEG/WebP images directly into the interview composer, or use **＋ Image** on a phone. The composer preserves accompanying text, displays a private thumbnail with preview/removal, and blocks sending during upload. At most two images are allowed per turn. Normalization strips metadata and resizes visual pixels; the same upload bounds apply to paste and file selection. Failed uploads or sends retain the text and successful staged references for recovery. Chat and preview share the available desktop height; phone tabs give each panel the available viewport.

When the saved NStack connection uses `browser-user`, image upload additionally requests fresh member signatures for that exact selected workspace. The bounded plan prepares a private object, uploads normalized bytes through the signed Tower API, completes with SHA-256, and verifies private owner/hash/size metadata. It never follows a response-supplied upload or download URL. Existing object bindings are reconciled by signed metadata before any retry; an already completed exact object needs no repeat transfer. A connection revision change or failed/mismatched readback stops the operation. Staged references appear only after confirmation. Workspace membership is required for this mode; denial leaves a visible error and permits retry. Without a browser-user connection, the existing app-private attachment flow remains available and returns `storage: app-private`.

This member upload uses Tower's existing workspace storage API and does not activate generated-app file capabilities or managed background storage grants. The app retains its private normalized image copy for exact job/run tickets, so native turns do not require the participant to sign background reads. The NStack object is private to the uploader/workspace authority; it is never published to Blossom or linked to a public site. Removing a staged reference removes it from the message draft, not from retained storage. Project deletion revokes BYO access while retaining private records and storage for recovery. Previously downloaded bytes cannot be recalled.

Additional acceptance: `bun integration/workshop-browser.ts` checks desktop and phone guidance/layout, paste/select, error recovery, keyboard submission, publication and confirmed deletion using an isolated app database and real signatures. Operational screenshots are written only to ignored `tmp/docs/handoffs/`.
