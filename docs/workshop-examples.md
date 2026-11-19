# Release-tested workshop examples

The first-party catalog contains three static, self-contained examples: a Bitcoin inheritance explainer, a purchasing-power scenario calculator and an editable fictional hair-service price calculator. The organiser's existing retirement selection is independent and must stay unchanged. All examples use system fonts, inline code and styles, no remote assets, backend, storage, accounts or extra permissions. Their reusable source is in `examples/`; `src/workshop-catalog.ts` supplies the approved reference documents and `examples/catalog.v1.json` pins their exact package/document/catalog hashes. Changes require a reviewed catalog version and updated pins, never silent replacement of installed packages.

The inheritance guide is general education, not a will, template, generator, legal advice or security recipe. It has no private data fields. Never ask for seed phrases, private keys, passwords, balances or real testament information. Fictional Alex and Sam explain the difference between legal intent and authorised technical recovery. Links inside the package attribute Bitcoin.org, ASIC Moneysmart and We Are Bitcoin (an educational publisher, not a legal authority). Host-owned source links also open outside the unchanged sandbox. The concise original text stays below the source derivation limits. No published will clauses or whole articles are copied.

Inflation and nominal interest are editable hypothetical scenarios, not current rates, forecasts, returns or financial advice. Nominal = balance × (1 + interest/100)^years; purchasing power = nominal / (1 + inflation/100)^years. Bounds: balance 0–1 billion, years 0–100, rates −20% to 50%. Zero years preserves the balance, zero balance remains zero, negative rates have their ordinary arithmetic meaning. Blank, nonfinite and out-of-bounds inputs show an actionable correction rather than a number. Extreme valid values wrap instead of overflowing; arithmetic is not clamped. The RBA's inflation/CPI and inflation-target explainers are linked. Hair prices are fictional; `(service + selected extras) × quantity`, prices $0–$10,000, whole quantity 1–20. No quote, booking or payment is created. All edits and learning ticks are temporary.

## Signed administrator installation and selection

Use **More → Install built-in examples** to install, then **Choose workshop examples** to preview/review the exact installed version and select it with its reviewed starting document. Installation alone never selects or publishes anything. The API is useful for operators who want exact replayable payloads:

1. Signed member `GET /api/projects/:projectId/workshop` returns each selection revision. Signed admin `GET /api/projects/:projectId/workshop/catalog` returns the three release-pinned catalog entries, package hashes, catalog hashes, source links and starting documents. Review the repository packages and matching release browser evidence.
2. Signed admin `POST /api/projects/:projectId/workshop/catalog` installs one exact built-in example. No caller-supplied HTML, documents, validation evidence, jobs or native receipts are accepted as package inputs. Body:

```json
{
  "starterId": "bitcoin-will",
  "catalogVersion": 1,
  "catalogHash": "<exact GET catalogHash>",
  "packageHash": "<exact GET packageHash>",
  "expectedRevision": 0,
  "confirmPackage": true,
  "requestId": "<unique installation request ID>"
}
```

Use the current selection revision, not a guessed zero. An identical retry returns the same result. A different request with the same catalog reuses its version; changed hash/version/revision fails. Installation does not alter any selection, existing source, messages, publication, or participant work. The response supplies `versionId`, `document`, exact hashes and `selected:false`. It uses the normal design/snapshot/milestone/artifact/version records and shared scoped static-package validation. Its provenance is `app-supplied-release-tested-example`; there is no native job/run or forged model-build evidence. Production images include the source assets and pins.

3. Preview the installed exact version through the ordinary authorised preview. After review, signed admin `PATCH /api/projects/:projectId/workshop` selects the version via existing approved sharing:

```json
{
  "starterId": "bitcoin-will",
  "versionId": "<installation response versionId>",
  "document": "<reviewed installation response document>",
  "confirmPackage": true,
  "expectedRevision": 0,
  "requestId": "<unique selection request ID>"
}
```

Repeat for `inflation` and `hair`, preserving the retirement record exactly. Use fresh readback revisions for every intentional selection, and the same payload/request ID on uncertain retries. No auto-overwrite occurs. Existing approved sharing, revocation, lifecycle checks and participant-owned independent imports stay authoritative. An unavailable/revoked example is omitted from the named cards with an organiser notice; the server rejects a new named start without a real package. Own idea/help remain available.

## Existing conversations and mobile access

Cards offer Open example and Use example. Personal imported conversations always expose Open example outside desktop Preview, with a full-screen phone dialog. Each starter has one concrete opening question and three editable suggestions. Starting documents and sample choices remain unconfirmed reference material.

A workshop conversation without an imported reference offers an explicit chooser of currently available examples. It does not assume the old starter ID matches the current topic. Open example previews the selected package. Use example as reference calls the owner-authorised `POST /api/designs/:id/starter-reference` with `{entryId,expectedRevision}`. The selected entry/revision is checked atomically; active turns block a new attachment, exact retries are harmless, a different subsequent attachment conflicts. Attaching creates only the ordinary scoped import reference and an attachment receipt. It never replaces the conversation, title, messages, snapshots, current design or native session. The reference remains unconfirmed. Another participant cannot read or attach to this design.

## Native pipeline activation

Source includes additive `byofreedom.prepareInterview.v9` and `byofreedom-interview-v10` (`INTERVIEW_WORKFLOW_VERSION=interview-v10`). Install them as new immutable versions through the normal root/admin pipeline operation, with a fresh exact-composition grant. The function chain is `byofreedom.prepareInterview.v9` → `session.scopedInterviewTurn.v1` → `byofreedom.finishInterview.v5`. Preserve existing installed versions, in-flight bindings and retained recovery grants. The app-owned bounded `context.workshop` v2 describes the chosen starter, attached-reference availability, first-turn flag and structured opening. The new preparer uses only recognised starter IDs, preserves complete current design/import/source provenance and native conversation key, and keeps scoped source/image tools and reply-first completion. On later turns the participant's current topic overrides legacy starter hints. Brand/storage text is not used for interview behaviour. No Autopilot/Tower restart or platform change is needed.

Manager activation requires the normal fresh exact-definition/function-composition grant and matching `INTERVIEW_PIPELINE_CONFIG` plus private credential. Preserve both origins, image/scoped tools, existing builder/storage settings and persistent volume. Preserve old credentials for original-job recovery. Only root owns live deployment, pipeline installation/grant activation, catalog selection and hosted native acceptance. Source tests do not prove activation or actual native model behaviour.

## Progress and verification

Normal running/polling text reads exactly “Your designer is working on that now” (or “Your builder is working on that now”). The UI also maps a small exact allowlist of historical normal running strings without rewriting persisted jobs. Queued, uncertain, failed, retry and arbitrary actionable progress text remain truthful; poll and delivery failure warnings stay separate. Signed run binding, callbacks, replay and completion rules are unchanged.

Run frozen install, `bun run check`, `BYO_DOCKER_VALIDATION_TEST=1 bun test`, `bun run build` and `git diff --check`. The Docker-enabled full test command includes the actual isolated package validator and production-image startup/assets test. There is no test filename matching `actualDocker`. Run `bun integration/workshop-examples-browser.ts` for signed installation/selection, all four actual examples, controls/bounds/maths, source links, personal copies, explicit legacy attachment, historical running text, drafts and 375/390 phone summaries. `bun integration/workshop-journey-browser.ts` covers broader desktop/phone workshop, result SDK, name failure, reload and participant build gates. Both use isolated SQLite and real Chrome, with synthetic interview callbacks; no physical-device, live model or hosted acceptance claim. Screenshots/logs remain in verified ignored `tmp/docs/handoffs/`.
