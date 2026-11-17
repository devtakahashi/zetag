# ZeTag profiles setup

Extract the contents into the root of the devtakahashi/zetag repository. Keep
the existing assets/avatars folder and other files. The changed homepage adds
a Profile link. The eight uploaded .webp files supply the preset picker.

Profiles use the same Cloudflare Worker route and D1 database as the existing
optional short checkout links. GitHub Pages serves the frontend. From backend/,
configure the existing database ID in wrangler.toml. If no database exists,
follow the Worker and D1 setup in the existing README first.

Apply the additive profile schema and deploy the updated Worker:

```sh
npx wrangler d1 execute zetag-requests --remote --file=profile-schema.sql
npx wrangler deploy
```

The profile feature uses the /pay/_profiles endpoint on the same origin.
On the deployed site, connect a wallet, enter an unused tag, choose an avatar,
and approve the signature. Reopen the copied profile link in a different
browser to confirm it loads, then reconnect the original wallet and update
the avatar. One wallet can claim one profile. A second wallet cannot overwrite
the tag. Wallets must support message signing. No funds move during profile
creation.

The ZePay profile button opens the existing Send form with the tag prefilled.
Live transfers and Ping are separate work. Uploaded profile photos are resized
in the browser and stored with the public profile.
