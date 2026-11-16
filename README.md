# ZeTag

A responsive interface for sending and requesting USDC on Solana by tag.

## Run and publish

Open index.html, or run `python3 -m http.server 8080` and open
http://localhost:8080. For GitHub Pages, commit these files to the root of
your publishing branch. No build step is required.

## Current behavior

Send and Receive switch the hero copy and form. Receive can create
shareable request links and save the profile in the current browser.
Request links can prefill Send. Payments are currently unavailable.
The project has no global tag registry or authorized
Zelle Tag linking. The Send form does not issue payment confirmations.

## Wallet connection

The header supports Jupiter, Phantom, Solflare and Backpack when their Solana
providers are available. Use localhost or HTTPS. Wallet connection only reads
the public address. The account panel shows current mainnet USDC balance,
plus net increases and decreases across the same recent sample as History.
Activity checks up to 20 successful candidate transactions across the wallet
address and up to four current USDC token accounts. This is not a lifetime
ledger and can miss older or closed accounts.

The default public mainnet RPC can throttle requests. Set a
`<meta name="solana-rpc" content="https://YOUR-BROWSER-SAFE-RPC/">`
in index.html to use a browser-compatible RPC endpoint. URLs in HTML are public.

The footer links to privacy.html, terms.html, and help.html. Upload all three
with the homepage. Review the privacy and terms copy against your production
operations before relying on it as your published policy.

## Share popup and payer checkout

GitHub Pages can serve `pay/index.html` immediately. With the default settings,
links use `/pay/#…` and include the request fields in the fragment. The popup
hides this longer URL until the clipboard needs a manual fallback. Treat request
details as shareable and unverified. Checkout previews the request with payment
disabled.

### Optional clean links

The included Cloudflare Worker and D1 schema enable URLs like
`zetag.fun/pay/deficrawler-5000-<id>` with one stored request per link.
The domain must be on Cloudflare DNS, with the GitHub Pages site still serving
the other paths and the apex web record proxied. Deploy the frontend files to
GitHub Pages before enabling the worker.

1. From `backend/`, run `npx wrangler d1 create zetag-requests` and insert the
   returned database ID into `wrangler.toml`.
2. Apply the schema with
   `npx wrangler d1 execute zetag-requests --remote --file=schema.sql`.
3. Run `npx wrangler deploy`. Configure rate limits on POST `/pay/_requests`
   before opening it to public traffic. The endpoint accepts public requests.
4. Add `<meta name="zetag-short-links" content="enabled">` to the homepage
   and deploy it. Test creating a request and opening it in another browser.

Stored notes and display names are accessible to anyone with the link. Use
non-sensitive request details. USDC transfer and verified tag ownership require
separate wallet and registry functionality.
