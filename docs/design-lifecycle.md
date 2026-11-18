# Design milestones and immutable revisions

An interview or direct document edit creates an immutable `snapshot` revision. User-visible **Design 1** keeps evolving across those revisions until the builder actually registers a new tested artefact package. A website publication toggle does not establish a milestone. Failed builds, builder discussion and registration of identical package bytes do not establish a milestone either.

Successful package registration freezes the visible milestone at the exact source snapshot used by that build. The next saved interview response or direct edit opens the next Design, with the previous milestone and exact latest relevant artefact version as parents. Draft revisions saved while a build was running are retained and grouped into the next draft when that older source is registered. This avoids displaying a frozen milestone with document bytes that were never built.

Build conversations select an exact snapshot; every queued build turn copies that snapshot into its immutable job context. Editing the interview cannot alter this source. A later turn in the same implementation conversation keeps the same selected source and automatically starts from its last registered artefact. To build a newer design revision, open a new implementation conversation through the design picker.

The visible picker offers each milestone's frozen source or latest draft revision. API callers can still select any retained historical snapshot ID. The original `snapshots` response remains the complete immutable revision history; `milestones` supplies visible numbering, source `snapshotId`, state, revision count, frozen source, artefact IDs and parent references. Implementation responses include their exact snapshot and current grouping `designPin`.

## Concurrent publication and recovery

Grouping is separate metadata, never replacement of snapshot bytes or build source IDs. The queued job's `designPin` records the grouping known at build start. A version records this as `sourceDesignPin`, and records its classification at registration as `designPin`. If an older in-flight build publishes first, newer revisions may now belong to the next Design; the pending job's exact source and original context remain unchanged. This is classification of history rather than repinning execution.

If newer source finishes first and an older build completes later, the older result attaches to its original milestone and cannot change the frozen source or active draft. The interviewer automatically receives the latest relevant artefact ranked by source revision ordinal, then artefact version number. Thus a late old-source package cannot silently become the base for a newer interview. An explicit participant selection can still provide an older version as feedback context.

Snapshot compare-and-swap rejects concurrent saves against the same base. Interview callbacks similarly reject a changed base, with explicit rebase recovery preserving the failed turn. Publication uses the existing transactional durable receipt and package hash: retries cannot duplicate an artefact or freeze another milestone. Identical-package no-change reuse returns the existing version without establishing another boundary.

## Additive historical migration

`designLifecycle`, `designRevision` and `designMilestone` are additional SQLite record kinds. On first access, historical snapshots are grouped around existing artefact source revisions in snapshot order. Revisions through each built source belong to that milestone; revisions after the last built source form the current draft. Multiple packages built from one source share a milestone. No snapshot, version, job, content or old ID is removed or overwritten. Existing build source links remain valid. Grouping migration runs transactionally and is idempotent on reopen.

The whole-core SQLite destination is unchanged. Back up the existing database before deploying. This lifecycle migration is independent of selecting an NStack destination for generated application data.

Before serving requests, the deployed server creates a one-time consistent SQLite `VACUUM INTO` backup under the database directory's private `backups/` folder. It verifies `PRAGMA integrity_check`, restricts the backup to0600 and records an idempotent `migrationBackup` marker only after verification. Lazy milestone grouping starts after this startup step. A failed backup prevents startup; it never silently proceeds with migration. Backups are not served through any route. Restore requires stopping only the authorized app, preserving the current database/WAL, restoring the verified backup to its database path and reopening; coordinate this separately with the deployment manager. The source test restores the backup through a separate database connection and verifies exact pre-grouping records.
