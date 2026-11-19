# Managed interview attachment storage

Interview images use a dedicated server-configured NStack connection, independently of the participant's selected data connection. The browser authenticates to BYO; only the managed gateway holds its capability. No participant workspace membership or exported signing key is needed.

`createManagedInterviewStorage` accepts normalized images already stored by `createInterviewImages`. It checks participant/design/project access before and after remote calls, derives a namespace from project, design and participant owner, and verifies a remote download against the exact local bytes before returning `nstack-private`. The private local copy remains available to native job/run image tickets. Storage failures preserve that copy for deduplicated retry but must not return remote-storage success.

The owning app integrates the module through an injected `interviewStorage.put(actor, designId, imageId)` dependency. Configured managed uploads must fail closed on custody errors and must keep existing app authentication and image normalization. During staged activation, an absent managed connection may retain the explicit legacy storage behavior; configure the managed connection only after gateway acceptance. A configured connection with incomplete gateway settings must fail startup. Do not use the participant's saved data connection as this dependency.

## Configuration

- App: `BYO_INTERVIEW_STORAGE_CONNECTION_JSON` contains only `endpoint`, `serviceNpub`, `workspaceOwnerNpub`, `appNpub` for the approved managed gateway binding. Use the existing server gateway URL/token-file configuration for this exact app/installation. Do not expose the token to browsers.
- Gateway: `BYO_INTERVIEW_STORAGE_MAX_BYTES=2097152` enables the interview adapter. Matching Autopilot and Tower storage grants must authorize at least this object size, with explicit finite quota, object count and expiry. Existing managed runtime supplies the process-scoped file broker capability.
- `/v1/interview-images` accepts bounded JSON envelopes for up to 2 MiB binary images. It uses a distinct registry collection and row prefix so `/v1/files` cannot read image objects. Transfers verify exact service/workspace/delegation/installation, expiring same-origin URLs, size and SHA-256.
- General generated files remain disabled in the gateway unless `BYO_NSTACK_FILES_ENABLED=1` is separately configured. Their adapter limit remains 256 KiB even if the underlying grant permits larger interview images. Image configuration does not alter generated-app SDK limits or saved connections.

Prepare keys are deterministic UUIDs scoped by installation, delegation, namespace, digest and size. Retrying after a lost prepare or completion response reuses the object. A registry insertion conflict is accepted only after reading an exact matching namespace/hash/size row. Never overwrite a conflicting binding.

Changing grant files can be hot-read only when the platform processes already have the supported grant-file environment and mounts. Otherwise an operator-approved process activation is required. Source installation, parser validation and mocked transfer tests do not establish live storage availability. Activation and final release require real upload/download, namespace denial, retry, and native image-ticket checks by the release owner.
