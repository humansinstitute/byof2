# Registered-app interview image storage

This opt-in server path lets BYOF participants paste private interview reference images using the registered backend app's authority. Participants authenticate to BYOF and retain the existing participant/design/project ACLs; they do not sign Tower requests or need Tower membership. The backend app and browser-private app remain separate identities and namespaces. Existing saved settings and data are not migrated.

## Explicit selection

Set `BYO_INTERVIEW_STORAGE_MODE=registered-app` on both the BYOF server and its existing NStack gateway. On the server, configure `BYO_INTERVIEW_STORAGE_CONNECTION_JSON` with exactly `endpoint`, `serviceNpub`, `workspaceOwnerNpub`, and `appNpub`, selecting the existing owner-approved backend identity. Keep `BYO_NSTACK_GATEWAY_URL` (exact HTTPS `/v1/data`) and `BYO_NSTACK_GATEWAY_TOKEN_FILE` (server-only owner-readable capability file). The server sends images only to the sibling `/v1/app-images` route.

The gateway retains its existing exact `BYO_NSTACK_GATEWAY_BINDINGS_JSON`, managed DB broker and immutable `byo_documents` registry. AP supplies these process-only values to the installed gateway:

- `WAPP_REGISTERED_APP_STORAGE_BROKER_URL`: HTTP loopback `127.0.0.1` with exact path `/api/internal/wapps/registered-app-storage`.
- `WAPP_REGISTERED_APP_STORAGE_CAPABILITY`: opaque process capability; never copy into browser configuration or logs.
- `WAPP_REGISTERED_APP_STORAGE_BINDINGS_JSON`: array of installed binding rows containing `installationId`, `appId`, `ownerNpub`, `workspaceOwnerNpub`, `appNpub`, `bindingId`, `workspaceId` (string or null), `origin`, `protocol` (`registered-app-storage-v1`) and `maxObjectBytes` (8388608).

Every approved gateway binding must have exactly one matching runtime installation/origin/workspace/app tuple. The existing service identity allowlist remains part of connection matching. AP owns signing custody, registration checks, target origin and capability revocation; BYOF never imports keys or accepts a caller's signing URL. No legacy delegation grants are used.

With the mode unset, existing managed/browser behavior is preserved. Explicit standard mode requires a configured connection and gateway and fails closed on missing bindings, unavailable storage or mismatched receipts. It never switches to browser signing or reports local-only bytes as remote success. `managed` explicitly selects the older path. Unknown modes fail startup.

## Private lifecycle and bounds

The adapter calls only relative standard storage operations through the AP broker: descriptor, prepare, bounded JSON PUT, complete, metadata and content. It checks protocol, owner/app identity, private-only descriptor, supported operations, object identity, image type, name, size and SHA-256. Images are canonical base64 PNG/JPEG with a 2 MiB binary ceiling. Provider URLs, bearer download tickets and arbitrary signing targets are not consumed.

Prepare UUIDs deterministically include protocol, origin, installation, workspace, app, design namespace, hash, size, filename and type. Lost prepare/completion responses retry the same object. Completed objects skip upload and are reverified. Success requires complete metadata and a matching downloaded byte readback. The server independently reads back before writing its completed attachment receipt.

The gateway stores namespace/hash/size in `byo_app_image_bindings` rows prefixed `app-image:` in the existing app DB. Successful insertions are read back; conflicts are accepted only when the existing row matches exactly. Reads require the exact registry namespace and verify the returned size/hash. This registry guard is mandatory: the low-level AP adapter knows app authority, while design namespace enforcement belongs to the gateway and BYOF ACL layer. Legacy `/v1/files` and `/v1/interview-images` use distinct registries and cannot retrieve these objects.

The normalized private relay copy remains available for exact native job/run image tickets. Workflow pins, callbacks, saved history, old private views, origin aliases and paste UI are unaffected. General generated-app files remain separately disabled and capped at 256 KiB.

## Validation and integration

Run `bun run check`, `bun test`, `bun run build` and `bun integration/registered-app-files-browser.ts`. The browser harness uses real Chrome, real BYOF signatures, in-memory BYOF data and a local HTTP fake standard API. It exercises paste normalization, private remote receipt/readback, retry/reload, configured storage failure, mobile layout and unchanged job attachment metadata. It does not prove hosted Tower/AP activation or real S3 availability.

Source changes and tests can be prepared without live configuration. Combined deployment must preserve current origins, callback URLs, workflow pins and data volume, and needs its own authorization and hosted smoke test. Never activate historical managed grant drafts for this path.
