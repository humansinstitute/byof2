# Generated app data on NStack

NStack settings choose the destination for generated app data. Existing SQLite interviews, projects, designs, jobs, profiles and site records remain in place. Saving or testing a connection does not migrate core records. Changing a destination after any installation exists is blocked until an explicit verified migration and rollback workflow is provided.

An admin opens **My Projects → More → Data connection**, discovers NStacks from the current signer's encrypted self-index (or the browser's NStack provider), or enters an HTTPS address. Discovery verifies public metadata and freshly signed workspace access; the user explicitly chooses a workspace and selects **Connect and save**. No copied IDs or profile writes are required. The encrypted kind33356 `workspace-self-index` protocol is reduced by newest authenticated address before decryption, including tombstones. Invalid newest entries do not revive older state. Provider disclosures are hints, never authorization.

Connect verifies a fresh service-signed connection challenge, current membership and exact Tower/workspace/app identities. It registers BYO Freedom's static public app namespace through the existing typed PG registration route, checks that it is enabled and private-only, then creates or reads back an actor-private versioned schema marker. Generic JSON collections are used; this does not create physical SQL tables or a service principal. Global settings are saved atomically only after all checks succeed. Revision conflicts preserve the newer selection. Retrying interrupted setup reads back completed registration/schema work. Disconnect is explicit, revision-guarded and allowed only with no installed app records; it archives the old setting, advances the revision and deletes no remote rows.

**Browser-authorized mode supports private user data only.** Every user must independently belong to the chosen NStack workspace, including people using generated browser identities. A BYO project membership alone does not grant Tower access. Shared/public policies, anonymous reads, background operations and files are unavailable in this mode. A ready saved setup means private browser-authorized operations can be attempted; each operation still requires the current user's signer and fresh Tower membership. No user signature is treated as server service authority.

The trusted parent asks the BYO server for an ACL-checked operation plan. The server returns only exact bounded Tower requests under the selected workspace and BYO namespace; the parent supplies a fresh NIP-98 signature for each, bound to actor, request bytes and challenge. Local settings/installation revisions are checked again immediately before execution. The sandbox receives data only, never plans, signatures or signing access. Discovery uses a separate GET-only plan; arbitrary proxy URLs and arbitrary signing requests are unsupported.

Existing managed gateway connections retain their original separately granted scope and policies. The fixed gateway is never repointed by a browser-selected workspace. Public descriptor verification alone cannot establish managed signing authority. Source and runtime capabilities remain distinct.

## Exact version installation and SDK

A builder receives `context.storage` with the SDK source, manifest contract, public origin and current capabilities. It can package `byo-data.json`:

```json
{"version":1,"collections":[{"name":"items","policy":"private","maxRecords":100,"maxBytes":16384}]}
```

The file is validated when a tested package is registered and stored with that immutable version. It requests permissions; registration does not grant them. An admin opens that version's **More → Data permissions**, reviews the suggested manifest and explicitly enables the exact version. The active permission revision is separately revocable. A newer artefact version needs its own explicit installation. Empty manifests grant no collection access.

`public/data-sdk.ts` exports `createFreedomData()`. Package this source as JavaScript with the app and call `list`, `get`, `put`, `remove`, `filePut` or `fileGet`. Select **Open saved app** on an artefact version to use its live namespace in an authenticated sandboxed modal. Compatible installed versions share those saved records. The normal workspace frame is labelled **Test preview** and uses its separate preview scope. The authenticated BYO workspace attaches a bridge to its exact sandboxed preview frame. Both directions validate the source window; an unguessable channel and exact immutable version bind each request. The parent signs the narrow app operation. The child receives data responses only, never a signer, user key, admin token, raw SQL or arbitrary remote request facility. An unattached standalone preview reports an unavailable bridge. Whole Site Builder private previews do not relay authenticated app data through their nested frames; use the exact version’s preview or saved-data launcher to exercise data.

`createFreedomPublicData(origin, versionId)` permits anonymous `get` and `list` against public collections of an actually exposed exact artefact version. It cannot mutate data. Public-read responses enable CORS; private endpoints continue to require fresh NIP-98 authentication. Direct standalone app data writes require an authenticated BYO parent bridge.

## Policies, scopes and revisions

- **Private:** authenticated project members have separate actor namespaces.
- **Shared:** project members share the app namespace.
- **Public:** anybody can read after the exact version is publicly exposed; only admins write.

Every operation checks the exact active installation, project membership, policy, connection identity and collection. Read permission is checked again after awaiting remote data; revocation during an in-flight read fails closed. Ordinary JSON writes cannot forge reserved file metadata.

Browser-authorized collection names also include the selected workspace UUID and actor, because Tower generic app rows may share an owner/app backing namespace across typed workspaces. Live namespaces derive from project, artefact, collection and policy identity, and remain stable across artefact versions. Previews are separate by exact version and actor. Browser-supplied owner, project, namespace and remote path fields confer no authority. Each collection has at most 100 live records, 1,000 immutable mutation revisions and 64 KiB per JSON value; its approved manifest may set smaller limits. Reads paginate at most 100 records. Collection history is bounded and fails explicitly at its revision limit; there is no silent truncation.

The generic Tower mutable JSON PATCH contract has no compare-and-swap parameter. BYO therefore stores immutable mutation rows. Each mutation uses a unique collection-wide `rev:N` slot, plus the record revision and previous record/collection hashes. Concurrent processes attempting different records against the same state compete for the same atomic remote unique slot. One gets a conflict and must reload, preserving revision and quota correctness. Readers gather bounded pages, sort the sequence and reject incomplete or inconsistent chains. Deletes are immutable tombstones. The reviewed gateway may translate these generic-row operations into the existing typed app table API; all product values remain in the chosen NStack.

Files use a separately approved managed storage adapter when available. The server checks canonical base64, a 256 KiB limit, exact byte size, SHA-256, safe filename and content type before upload. It stores only remote object metadata in immutable JSON rows, and verifies retrieved bytes again before returning them. Neither storage credentials nor external provider URLs reach the generated app. Without the exact storage binding, file operations return an explicit unsupported error. A storage upload that completes but loses the subsequent immutable metadata race may leave an unreachable remote object; no logical file is registered and no local fallback is used. Storage reclamation is an operator workflow.

## API

| Method | Route | Contract |
|---|---|---|
| GET / PUT | `/api/nstack` | Admin settings; save includes `expectedRevision` and `connection` |
| POST | `/api/nstack/connect` | Admin verified browser-user setup with `expectedRevision` and exact discovered `connection`; returns a signing challenge or completed result |
| POST | `/api/nstack/authorize` | Current actor authorizes the exact outstanding operation/challenge; no supplied URL or body is executed |
| POST | `/api/nstack/discovery-request` | Admin HTTPS public metadata or bounded signed workspace-list/membership GET |
| POST | `/api/nstack/disconnect` | Admin `{expectedRevision,confirm:true}`; refuses any installed app records and retains configuration audit |
| POST | `/api/nstack/test` | Admin authenticated test of saved `expectedRevision` |
| GET / PUT | `/api/artifacts/:artifact/data-installations` | Admin exact version grants; save `{versionId,expectedRevision,enabled,manifest}` |
| POST | `/api/installed-apps/:version/data` | Signed project actor; `{operation,scope,collection,id?,value?,expectedRevision?,limit?,offset?}` |
| GET | `/app-data/:version` | Anonymous exposed-public read only; `operation=get/list`, `collection`, `id` or pagination |

File put uses `operation:"file.put"`, logical record `id`, `expectedRevision`, `bytesBase64`, `sha256`, `size`, `name`, and `contentType`. File get uses `operation:"file.get"` and logical record `id`. Remote object IDs cannot select files through the browser API.

The approved custody deployment, exact endpoint/app bindings, typed table provisioning and managed storage installation are operational prerequisites. Source tests with injected transports verify isolation and concurrency; they are not proof of a hosted NStack deployment. Real signed CRUD, reopen, policy isolation and file put/get need separate deployed acceptance evidence.

## Managed gateway deployment

`gateway/` is a separate managed app root; it imports the reviewed implementation from this repository. Start with `bun ../scripts/nstack-gateway.ts`. The gateway consumes only Autopilot's injected process-scoped `WAPP_TOWER_DB_BROKER_URL`, `WAPP_TOWER_DB_CAPABILITY` and `WAPP_TOWER_BINDINGS_JSON`. It never imports custody stores or unwraps keys. Bind a separate WApp installation and identity; do not change the existing pipeline installation or grants.

Configure `BYO_NSTACK_GATEWAY_BINDINGS_JSON` as an array of public `{endpoint,serviceNpub,workspaceOwnerNpub,appNpub,installationId}` values. Every entry must match an injected managed binding. Configure `BYO_NSTACK_GATEWAY_TOKEN_FILE` as an owner-only0600 file containing a random server capability. Expose this loopback managed app through its approved HTTPS endpoint. `GET /health` is public liveness only; authenticated `POST /v1/data` accepts only the exact configured namespace and bounded immutable rows, and `POST /v1/files` accepts only file operations with namespace-bound receipts. Neither route is a signing API, SQL endpoint or arbitrary destination proxy.

Initial gateway provisioning requires explicit `BYO_NSTACK_GATEWAY_PROVISION=1`. Startup submits only the fixed `byo-documents-v1` migration from `src/nstack-gateway.ts` to the supported typed DB broker. Its checksum uses Tower's `sha256:` format. The table has a unique collection/row ID pair, enforcing immutable collection-wide revision conflicts across app processes. Subsequent identical migration calls are safe. No migration body can be supplied through HTTP. Disable the provisioning flag after successful setup.

On the cloud BYO server, set `BYO_NSTACK_GATEWAY_URL=https://<approved-gateway>/v1/data` and either mount `BYO_NSTACK_GATEWAY_TOKEN_FILE` or supply `BYO_NSTACK_GATEWAY_CREDENTIAL` through authorized managed deployment. Startup writes the latter to0600 `storage-grants/gateway.capability` beside the core database, deletes the credential environment value, and exposes no credential through settings. Rotating this opaque capability requires coordinated server configuration; it does not rotate the WApp signing identity.

File availability additionally requires the gateway process to receive the supported `WAPP_REMOTE_STORAGE_BROKER_URL`, `WAPP_REMOTE_STORAGE_CAPABILITY` and `WAPP_REMOTE_STORAGE_BINDING_JSON`. Autopilot reads exact grants from its configured `WAPP_REMOTE_STORAGE_GRANTS_FILE`; Tower reads matching service delegations from `MANAGED_APP_STORAGE_GRANTS_FILE`. If those live paths are absent, the adapter cannot activate itself: configuring them requires the platform owner's separately authorized process activation. A gateway/app restart alone cannot invent a storage delegation. Without it, JSON can be available while files explicitly remain unavailable. Transfer tokens remain gateway-side; downloads/uploads validate the exact managed service, workspace, delegation, object, expiry, size and hash.

Builder preparation v4 and builder definition v5 introduce explicit scoped-SDK instructions while retaining publication handler v4 and its immutable Docker validator. Installing the new definition and exact remote grant is separate from committing source. Existing v4 definitions/grants remain available for old or uncertain jobs, whose saved binding must never be repointed.

## Project-member launcher

Enabling an exact version also authorizes project members to load that app package through the trusted `#/apps/:version` launcher. It does not grant access to the author's design, revisions, interview, implementation chat or package inventory. The signed `GET /api/installed-apps/:version` endpoint returns only title, version, project, artifact identity and an exact-package preview ticket after checking membership and current installation state. Disabled installations and nonmembers are denied. Existing issued package preview tickets retain the documented fifteen-minute bearer expiry; data permissions are independently rechecked on every operation.

The project page lists only enabled exact versions under **Project apps**, using minimal launch metadata. Published site pages add **Open app to save** for an enabled exact version; this points to the trusted authenticated app route and preserves the selected version through login. Anonymous site reads do not gain writes. The launcher runs the package in an opaque sandbox with the live data bridge, preserving stable app data across compatible enabled versions. New anonymous accounts still need project membership, through an active featured event or a project join code, before launching an app.

## Legacy managed connection hints

`BYO_NSTACK_CONNECTIONS_JSON` remains a metadata-only list for existing managed connections and integrations. It never selects or saves a destination or confers authority. The admin connection UI uses profile/address discovery and explicit workspace setup rather than requiring operator-provisioned hints. Existing managed settings and installed destinations are preserved; no automatic migration is performed.

## Save feedback and interrupted browser operations

Connect renders the verified returned settings immediately as **Saved · workspace · Ready**, retaining the app namespace and disconnect policy. A second signed settings read is not required for this success message. The returned revision and selected connection must match the submitted save. **Reload saved state** explicitly reads the authoritative settings.

Signing and requests have a two-minute client waiting limit. The dialog shows progress, allows **Cancel waiting**, and can be closed while waiting, including the initial settings read. Cancel/timeout aborts outstanding fetches and stops subsequent signatures and requests. A signing extension prompt itself cannot be withdrawn; its late completion cannot advance the stopped attempt. The parent SDK uses the same bounded operation helper and returns failures through its existing scoped response channel.

Stopping client waiting does not roll back remote work. A completed request may already have saved; interrupted and uncertain responses therefore report **Outcome unknown** and offer reload. No POST is automatically replayed. Signer denial, membership failure and revision conflict remain visible without claiming that the saved state necessarily stayed unchanged. Exact actor, challenge, namespace, payload and revision checks still apply.

Run `bun integration/nstack-postsave-browser.ts` for actual Chrome checks with isolated API/signing fixtures, including a never-resolving post-save GET that must not be invoked. `BYO_POSTSAVE_BASELINE=1` reproduces the committed-save hang against source `63d6b33`. Browser timeout cases shorten only the two-minute test timer; production retains the two-minute bound. These fixtures are separate from real signed HTTP/Tower integration and do not mutate a hosted app connection.

## Agent platform context

Both interview and build jobs now receive the bounded authoritative NStack contract described in [agent-storage.md](agent-storage.md). Interview preparev6 and builder preparev5 explicitly teach Postgres-backed records, object files, guestbook/photo patterns and actual policy/membership/availability limits. Files and shared storage are never inferred from private browser JSON readiness. New versioned definitions/grants must be installed separately; this source change does not activate storage.
