# Update ZeTag profiles

1. Extract the ZIP. Copy its `backend/profiles.mjs` and `backend/profile-social-schema.sql` into your existing local ZeTag `backend` folder. Keep your configured `backend/wrangler.toml` and its existing D1 ID.
2. In the VS Code terminal, from that same `backend` folder, run these commands one at a time.

   ```powershell
   npx wrangler d1 execute zetag-requests --remote --file=profile-social-schema.sql
   npx wrangler deploy
   ```

   This applies an additive migration to the existing database. After the Worker deploys, open `https://zetag.fun/pay/_profiles/broke` to check the public response for a known tag. It should contain the tag, avatar, bio, and join date.
3. Upload the ZIP's `profile/` folder, `wallet.js`, `privacy.html`, and the two backend files to the same paths on GitHub. Keep the existing avatar images under `assets/avatars/`. Wait for GitHub Pages to publish the update.
4. Open `https://zetag.fun/profile/` with the wallet that claimed your tag. Approve the profile sign-in message once for the new session. Revisit Profile and check that it opens without requesting another connection when the browser wallet supports silent restore. Test the pencil, bio, avatar picker, and copy-link icon.
5. Open the copied profile link in a private browser window. The public profile should show the tag, avatar, and bio. To test Ping, sign in as a second claimed ZeTag and open the chat icon.

ZePay opens the existing Send flow with the recipient's tag filled in. The activity tabs show empty states pending confirmed ZePay transfers and withdrawals.
