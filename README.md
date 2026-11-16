# Zellpay

A responsive prototype for sending and requesting USDC by tag.

## Run locally

Open index.html, or run `python3 -m http.server 8080` in this folder and open
http://localhost:8080. Localhost enables clipboard support in most browsers.

## Try it

- Choose Send, enter @drevon and an amount, review the payment, and generate a demo receipt.
- Choose Receive, pick a tag and display name, optionally set an amount and note, and open the generated payment page.

## GitHub

Commit the files in this folder to your repository. To preview with GitHub Pages,
publish from the root of the branch containing index.html. No build step or
environment variables are needed. Serve over HTTPS for clipboard support.

## Prototype limits

Tags are stored locally and are not globally registered or verified. Shareable
demo links carry unverified profile and request details. Payments and receipts
are simulated. A live version needs a server-backed tag registry, wallet
ownership verification, Solana wallet signing, and on-chain payment validation.
Linking US Zelle Tags requires an authorized ownership verification mechanism.
