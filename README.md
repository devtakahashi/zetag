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
