# Site Builder branding

Project branding is design context shared by new interview and implementation jobs. It contains the project logo, primary/background/text colours, a supported font family and button shape, tone, and written guidance. Each job receives a copy of the brand revision current when the turn was queued. Editing the brand later does not mutate an in-flight job or an older artefact version.

An admin can record explicit exceptions for an individual design. These have their own revision and remain separate from the project brand. An exception overrides only the stated part of the default; other brand settings remain applicable. The implementation records the project brand revision used for an artefact, so the admin interface can flag artefacts built before the current revision. Older artefacts without a recorded brand revision are treated as unknown or older, never as verified current.

New builds receive a reusable style contract containing CSS custom properties (`--byo-primary`, `--byo-background`, `--byo-text`, `--byo-font`, `--byo-button-radius`) and the `.byo-button` class. Generated content should use these shared tokens, apply the logo and tone where relevant, and test contrast, focus and responsive behaviour. Safe enumerated font and button choices and six-digit hex colours bound the executable CSS. Written tone, guidance and exceptions remain inert text rather than CSS or authority to run tools.

The site shell can adopt the selected brand without changing the internal appearance of existing generated HTML. Arbitrary older HTML is not automatically restyled. Rebuild an artefact deliberately under a newer contract when its internal appearance needs updating. A published whole-site release retains its own selected theme and exact artefact versions even after the draft brand changes.

The interviewer remains tool-free. Project brand guidance does not establish participant-confirmed requirements or override explicit participant exclusions. New interview preparation v4 forwards the pinned `context.brand`; existing v3 source remains unchanged. Builder preparation v3 already forwards the complete pinned context, including branding and its style contract. Installing or activating an updated interview definition and grant is an operational manager action separate from committing these source files.

## Admin workflow and routes

Open a project and select **Site Builder**. Choose tested, exact artefact versions, assign lowercase hyphenated addresses, select a homepage, and reorder or hide navigation entries. Hidden navigation entries remain publicly addressable when their release is published. Footer URLs accept HTTPS or safe local absolute paths. Choose a simple website, resource library or event hub shell, then save the draft before previewing or publishing.

Every Site Builder API request uses the existing NIP-98 signature and server admin allowlist:

| Route | Method | Input/result |
|---|---|---|
| `/api/projects/:id/site` | GET | Draft, exact-version choices and publication history |
| `/api/projects/:id/site` | PUT | `{expectedRevision,draft}`; stale revisions return 409 |
| `/api/projects/:id/site/preview` | POST | `{expectedRevision}`; authenticated HTML preview response |
| `/api/projects/:id/site/publish` | POST | `{expectedRevision,requestId,exposeVersionIds}` |
| `/api/projects/:id/site/rollback` | POST | `{releaseId,requestId}`; selects an existing immutable release |
| `/api/designs/:id/brand` | GET/PATCH | Explicit exceptions; PATCH requires `{expectedRevision,exceptions}` |

Clicking **Publish changes** saves the draft and directly publishes its selected exact versions, including private versions, without a repeated confirmation dialog. The signed request carries the saved revision and explicit selected version exposure list. It exposes only the selected package versions through that release. It does not change the artefact's original public version selector or expose other versions, interviews or designs. The stable site is `/sites/:project/`, with page addresses `/sites/:project/page/:slug/`. Immutable release roots and pages live under `/sites/:project/releases/:release/`. Each shell loads its artefact frame from its immutable release URL, so a later publication cannot swap its bytes mid-load. Original `/sites/:project/:artifact/` contribution URLs continue to use the existing selector.

Draft editing and publication are separate. Browser edits persist locally after a conflict; **Discard changes** appears when local edits exist and asks for confirmation before discarding them. Publication and rollback request IDs have durable receipts: retry an identical request ID/body after an uncertain response. Reusing a request ID with changed content returns a conflict.

## Private preview and sandbox

The signed preview API returns the selected packages only to an authenticated admin. An inert public `/site-preview-host` contains no project content. The admin page sends the signed response into its exact sandboxed frame, which renders nested opaque-origin frames without same-origin or account authority. There is no public Site Builder draft ticket. Existing individual artefact preview tickets retain their original expiry behaviour.

The private whole-site preview embeds static HTML asset references, CSS URLs and literal JavaScript imports as data URLs. Cyclic imports return 422 with an explanation. Dynamically constructed relative asset URLs are not rewritten; such packages may need their existing individual artefact preview for full behaviour checks. Published packages use real multi-file routes and do not have this embedding limitation. Preview and published generated content cannot access the parent identity or navigate the top page. External network use remains subject to CSP, browser CORS and the generated app's own handling.

## Persistence and activation

No destructive SQL migration is required. The existing generic SQLite record table gains `siteDraft`, `siteRelease`, `sitePointer` and `designBrand` record kinds; existing records remain intact. New artefact versions record `brandRevision` and the pinned `brandContext`. Old versions remain immutable and carry unknown brand status. Receipt storage continues to use the existing transactional `receipts` table.

Back up the database through the established consistent SQLite backup process before activation. Activate the new interviewer v4 function/definition and its exact installation grant separately from source publication. Builder v4 retains preparation v3, which already carries the new app context. Its publication handler v4 pins the official Bun 1.4.4 ARM64 manifest `oven/bun@sha256:f2b798e7ce1c056cd2149a6be7f014b3fde68a0c7165a3011ce3896e8404a6cd`; existing v3 stays immutable for historical recovery. The restricted Docker validation flags are unchanged. Keep original definitions/grants available for in-flight recovery; do not change a saved job's binding. Application rebuild/restart uses the registered managed runner. Cloud activation belongs to the deployment manager.

## Three-tab editor

The editor has three freely accessible tabs. **Site details** holds the site title, homepage, shell layout, footer and project brand. The homepage list contains only included pages; an empty site keeps the toolbox tab available. Site descriptions are not part of the current draft contract.

**Artefact toolbox** shows actual project artefacts and their tested versions. Visual previews and the expanded preview use the existing expiring preview URLs in opaque-origin sandboxed frames. No generated content executes with the editor's identity. Choose a tested exact version and **Add to site**; **Added** identifies an artefact already placed on the site.

**Pages & navigation** contains only included placements. Drag the page handle to another page, use Alt+Up/Down on the handle, or use the up/down buttons (including on touch devices). Change the navigation label, address and visibility without renaming the source artefact. Page/version options preserve exact pins; a newer tested version offers an explicit update action. New builds never change the selected page automatically. Removing a page removes its draft placement only; removing the homepage selects the first remaining page or leaves the site empty. Older releases and source artefacts remain intact.

Save draft, Private preview and Publish changes remain above the tabs. Discard changes appears there only while local edits exist, with explicit confirmation. Secondary typography and guidance fields stay mounted under Advanced brand. Hidden panels stay mounted so edits survive switching tabs and saving from any panel. Existing revision conflicts, local recovery, explicit Publish action, exact-version exposure intent and immutable publication/rollback APIs remain authoritative.

Toolbox and private whole-site previews open in a near-viewport dialog with a compact header. The frame uses the remaining height and scrolls its content on desktop and phone. Close, Escape and backdrop dismissal return focus to the opener when it remains mounted. Other dialogs retain their compact sizing.

## Compact site chrome and embedded content

The host uses one compact row for the project identity and project-page links. On narrow screens the links scroll horizontally without creating stacked menus. The selected page fills the remaining viewport; its sandbox owns document scrolling and section anchors. Empty host footers are omitted; configured footer links use a small, wrapping row. Resource-library and event-hub collection introductions are shown only without a selected page, rather than repeating the page list above every tool.

Private preview shows one selected page at a time with the same content frame sizing and embedded hint as publication. Its page links select preview sections without publishing content. Hidden navigation pages can still be selected through the preview API's `pageId`. The preview notice takes a small additional row. Package documents use sandboxed data URLs so fragment links resolve within the package, rather than inheriting the enclosing `srcdoc` base URL. The existing asset embedding remains in memory; stored package files and published executable bytes are unchanged. The existing static asset embedding limitations still apply.

New jobs receive `brand.embeddingContract` through the existing app-owned context. The current builder preparation forwards that context; this change requires no new pipeline definitions, grants or workflow selector. Previously queued jobs retain their original context.

The presentation contract is version 1: Site Builder frames (and original contribution wrappers) have `name="byo-site-embedded-v1"`. Generated packages can read their own `window.name` and add `byo-site-embedded` to their root element. The context supplies a detection script and optional CSS. Authors explicitly mark repeated identity with `byo-standalone-brand`, decorative footer content with `byo-decorative-footer`, and retained local navigation with `byo-section-nav`. Include this behaviour in the new package itself and test it in both modes. Essential attribution, disclosures, section links and tool controls must remain available. Embedded pages should use natural document flow without viewport-height spacers or redundant scrolling panels.

This name is an untrusted visual hint, not a capability. No parent DOM access, frame messaging, origin wildcard or same-origin sandbox permission is needed. Local anchors remain inside the package; they are deliberately not combined into the host menu. Changing host styling does not remove an old package's own header/footer, alter its executable files, or repin any release. Fully integrated branding in an old package requires an explicit new build, testing and version selection. Standalone artefact previews retain their existing presentation and data permission gates.
