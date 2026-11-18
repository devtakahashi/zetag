# ZeTag Ping and ZePay update

## Copy files and deploy the Worker

1. Extract the ZIP. Copy `backend/profiles.mjs`, `backend/worker.mjs`, and `backend/profile-ping-schema.sql` into the local `backend` directory where you already run Wrangler. Choose **Replace the files in the destination** if Windows asks. The ZIP contains only the three backend files needed for this update.
2. Copy `pay/index.html` into the local `pay` directory beside `backend`. The Worker packages this page during deployment.
3. In your VS Code terminal inside the local `backend` directory, run the D1 migration and wait for success.

   ```powershell
   npx wrangler d1 execute zetag-requests --remote --file=profile-ping-schema.sql
   ```

   Then run:

   ```powershell
   npx wrangler deploy
   ```

   The migration adds message read positions to the existing D1 database. Existing messages without a read position appear unread for their recipient.

## Publish the frontend

Upload `index.html`, `wallet.js`, the `profile` folder, `pay/index.html`, and the new `assets/emoji` folder to the corresponding GitHub paths. Keep the rest of the repository in place, including `profile/profile.css` and `assets/avatars`. You can upload the three changed backend files to GitHub as well to keep your source current.

After GitHub Pages publishes, hard-refresh the profile. Use two claimed ZeTags to verify Ping. A sent message shows one tick matching the timestamp. When the recipient opens and sees the message, the sender sees double pink ticks. Tag search suggests up to six public tags and avatars as you type at least two characters.

The wallet reads Solana USDC balances. A signed-in profile can use the Worker as a fallback when the browser's RPC calls are blocked. You can optionally set the Worker's `SOLANA_RPC_URL` secret to your provider's HTTPS RPC endpoint. The bell's transaction count covers recent confirmed USDC activity that the wallet can load, and transaction read state is stored in the current browser. ZePay includes the payment review UI. The live transfer flow is still disabled.

The 3D emoji artwork comes from [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji). Its license is included in `assets/emoji/LICENSE`.
