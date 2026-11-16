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
