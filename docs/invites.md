# Project invitations

Project admins can open a project and select **Share project · QR code** beside Project settings. Copy the complete URL or let participants scan the QR on screen. QR generation runs locally in the browser; no invitation is sent to an external QR service.

The canonical URL is `https://<app-origin>/ic=<encoded-project-code>`. The app also accepts `/?ic=<code>`. Codes are case-insensitive. Opening a link saves its code in session storage for that browser tab and removes it from the address bar. The invitation survives page refresh and anonymous account creation, NIP-07 sign-in or recovery-key restore. After authenticated membership is saved, the project opens directly and the pending invite is cleared. Fresh visitors see the workshop title and a required first name or nickname with Continue; browser identity, name and membership save behind that action without a profile detour. Existing identity controls remain secondary. See [the workshop journey](workshop.md). Visitors who are already signed in join/open immediately; repeating an invite is safe.

An invitation grants ordinary participant membership, using the existing authenticated join API. It does not grant admin access or expose other participants' private designs. Anyone with the code can join; change the project's join code to prevent future joins using an older URL. This does not revoke existing memberships.

A failed join keeps the invitation and shows the actual error, with retry or manual-code recovery. A failed signer operation can be retried. Invites take precedence over saved app-return routes; without an invitation, existing login routing is preserved. Links must be opened in the same browser tab through sign-in; session storage does not transfer between devices or separate browsers.

Validation:

```sh
bun test tests/invite.test.ts
bun integration/invite-browser.ts
```

The browser regression uses an isolated in-memory app with real signed API requests and a synthetic NIP-07 signer. It verifies anonymous signup, reload, extension sign-in, restored identity, repeated joins, invalid-code recovery, private-design isolation, copied URLs and decoding the actual rendered QR. It does not establish hosted deployment acceptance.
