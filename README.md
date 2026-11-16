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
The project has no global tag registry, wallet integration, or authorized
Zelle Tag linking. The Send form does not issue payment confirmations.

## Wallet connection

The header connects to Phantom through its browser extension or mobile in-app
browser. Preview over localhost or HTTPS. The app displays the connected
address and supports disconnecting and account changes. This does not enable
USDC transfers or register a tag on-chain.
