# Arxcess

Arxcess is a monorepo for a web-first encrypted digital goods marketplace built on Solana + Arcium. Sellers publish encrypted content with confidential key custody handled by Arcium's MXE network; buyers pay on-chain and receive content only after Arcium computes and delivers a buyer-specific decryption payload.

The platform exposes four surfaces:

- `Home` — landing page that routes users into the correct workflow.
- `Explore` — searchable, filterable storefront of active listings.
- `Launch` — seller workspace: encrypt file in-browser, upload to IPFS, publish on-chain with Arcium custody.
- `Library` — wallet-gated hub: finalize delivery (seller), reveal with frontend preview, download decrypted assets, or revoke access.

Core flow:

1. Seller encrypts file locally and uploads ciphertext to Pinata/IPFS.
2. Seller calls `create_product` + `request_deposit_product_key` on Solana — this queues an Arcium computation that wraps the content key under Arcium's MXE public key.
3. Arcium callback sets `arcium_custody_ready = true` on the `ProductState` account.
4. Buyer calls `purchase_product` on-chain.
5. Seller calls `request_evaluate_and_seal` — this queues an Arcium computation that re-encrypts the content key under the buyer's delivery public key.
6. Arcium callback writes the encrypted payload into `PurchaseState` and sets `arcium_delivery_ready = true`.
7. Buyer reads the on-chain payload, decrypts locally, previews the revealed asset in the frontend, and downloads when needed.

## Repository structure

```text
.
├── frontend/           # Next.js app for Home, Explore, Launch, and Library flows
├── sdk/ts/             # Shared TypeScript SDK package
├── contracts/          # Anchor workspace and Solana program config
├── encrypted-ixs/      # Rust workspace member for encrypted instruction-related logic
├── context/            # Local project context notes
├── .env.example        # Example environment values
├── Cargo.toml          # Rust workspace manifest
└── package.json        # Root npm workspace config
```

## Tech stack

- Next.js 14 + React 18 + TypeScript
- Solana wallet adapter + Anchor (Devnet)
- Arcium MXE — confidential key custody and buyer-specific delivery
- Pinata/IPFS — encrypted ciphertext and metadata storage
- Supabase — optional shared listing sync across browsers
- Rust workspace for Anchor program and encrypted-instruction helpers

## Prerequisites

### Frontend

- Node.js 20+ recommended
- npm 10+ recommended

### Contracts

If you want to work on the Solana program side as well, install:

- Rust toolchain
- Solana CLI
- Anchor CLI

## Getting started in WSL / Linux

Install dependencies from the repo root:

```bash
npm install
```

Start the frontend development server:

```bash
npm run dev
```

The app runs at:

```text
http://localhost:3000
```

## Available scripts

From the repo root:

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
```

These forward to the `frontend` workspace.

## Environment variables

Example values live in `.env.example`:

```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=sDNRRyCwQptaRZHATCha4nSJCFCwpcDWH2NvJCCAwFk
NEXT_PUBLIC_TREASURY_WALLET=
PINATA_JWT=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

For local frontend development, create:

```text
frontend/.env.local
```

Recommended local setup:

```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=sDNRRyCwQptaRZHATCha4nSJCFCwpcDWH2NvJCCAwFk
NEXT_PUBLIC_TREASURY_WALLET=your_devnet_treasury_wallet
PINATA_JWT=your_pinata_jwt
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### Notes

- `NEXT_PUBLIC_SOLANA_RPC_URL` sets the client RPC endpoint.
- `NEXT_PUBLIC_PROGRAM_ID` is required for program-aware flows.
- `NEXT_PUBLIC_TREASURY_WALLET` is required for on-chain `create_product` and `purchase_product` flows so protocol fees have a valid destination.
- `PINATA_JWT` is required for upload flows that send encrypted files and metadata to Pinata.
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` enable shared marketplace listings across browsers via `frontend/app/api/listings/route.ts`.

To enable shared listings, create the table in Supabase by running:

```sql
-- see supabase/marketplace_listings.sql
```

Then apply the SQL from `supabase/marketplace_listings.sql` in the Supabase SQL editor.

Do not commit local env files.

## Frontend flow

### Home

The landing page introduces the encrypted marketplace model and routes users into the correct public workflow:

- `Explore` for browsing and checkout
- `Launch` for publishing a locked product
- `Library` for opening delivered purchases

### Launch

The launch workspace:

- collects listing metadata
- uses a media-focused taxonomy: `Image`, `Video / GIF`, or `Other`
- encrypts the chosen file in the browser
- uploads ciphertext to Pinata/IPFS
- uploads metadata JSON
- asks the wallet to sign separate Devnet transactions for product creation, Arcium custody queueing, and later activation when the callback has settled
- stores the resulting listing locally and optionally in Supabase
- shows only essential listing terms such as price, access window, reveal limit, and revocable status

### Explore

The explore page reads stored listings and presents a minimal storefront. Buying sends the on-chain `purchase_product` transaction from the connected wallet.

- focuses the storefront on `Image`, `Video / GIF`, and `Other` listing types
- auto-generates or reuses the purchaser delivery key in-browser
- stores purchase intents locally after checkout succeeds
- highlights only essential public listing details such as publisher, price, access window, reveal limit, and revocable status

### Library

The library page is the reveal hub backed by local browser state plus on-chain purchase status. After checkout succeeds, entries move into `pending_seal` until delivery is finalized.

- shows purchased items with delivery status
- shows `Finalize delivery` only to the wallet that published the listing
- shows `Reveal` only to the wallet that created the purchase, then surfaces `Download` after a successful reveal
- shows `Revoke access` only to the publishing wallet when the listing is revocable

## Contracts

The Anchor workspace is configured in `contracts/Anchor.toml`.

Current localnet program configuration includes:

- cluster: `Localnet`
- wallet: `~/.config/solana/id.json`

To run Anchor tests from the contracts workspace:

```bash
anchor test
```

Make sure your Solana and Anchor toolchains are installed and configured first.

## Verifying Arcium integration on-chain

Every Arcium computation leaves verifiable on-chain state. You can independently confirm that Arcium is doing real confidential work using the Solana CLI or a script.

### Method 1 — Solana Explorer (browser)

After publishing a listing or finalizing delivery, the UI shows the Arcium **Queue tx** and **Delivery tx** in the proof panel. The custody settlement itself is asynchronous, so if Arcium has not called back yet you may see a pending settlement status without a separate callback signature. Click any available link to open the transaction on [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet). Look for:

- CPI calls to the Arcium program (`arcMXE...` program ID) inside the transaction.
- Anchor events emitted: `ArciumProductKeyComputationRequested`, `ArciumProductKeySettled`, `ArciumDeliverySettled`.

### Method 2 — Terminal: read on-chain account state

```bash
# Substitute your program ID and product/purchase account pubkeys
solana account <PRODUCT_STATE_PUBKEY> --url devnet --output json | \
  node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const buf = Buffer.from(d.account.data[0], 'base64');
// arcium_custody_ready is a bool stored at a known offset in ProductState
// Check contracts/programs/arxcess/src/state/product_state.rs for layout
console.log('raw data hex:', buf.toString('hex').slice(0, 120));
"
```

### Method 3 — Smoke test script

The repo ships `scripts/smoke-arcium-flow.mjs` which exercises the full end-to-end Arcium flow from the command line, prints every transaction signature, and cryptographically verifies the delivery commitment:

```bash
node scripts/smoke-arcium-flow.mjs
```

The script:
1. Creates a product and calls `request_deposit_product_key` → prints `custody_tx`.
2. Polls until `arcium_custody_ready = true` on the `ProductState` account.
3. Creates a purchase and calls `request_evaluate_and_seal` → prints `delivery_tx`.
4. Polls until `arcium_delivery_ready = true` on the `PurchaseState` account.
5. Reads `arcium_delivery_encryption_key` + ciphertexts from on-chain state, decrypts, and asserts the commitment hash matches the original content hash.

A passing run is cryptographic proof that Arcium performed real confidential computation — no hardcoded shortcuts could produce a matching commitment hash.

### Method 4 — Fetch Arcium computation account directly

```bash
# arcium_deposit_computation_offset is stored in ProductState once queued
# Use it to derive and fetch the MXEComputationAccount on-chain
solana account <COMPUTATION_ACCOUNT_PUBKEY> --url devnet --output json
```

A non-empty `MXEComputationAccount` with a matching `computation_id` proves the Arcium MXE node accepted and processed the job.

## Development notes

- Frontend state is browser-local for listings, purchases, and delivery keys, with optional Supabase sync for shared listings.
- The purchaser delivery keypair is auto-generated in-browser at checkout — no manual setup needed.
- Arcium confidential computation is live on Devnet; every publish and delivery goes through real MXE nodes.

## Git hygiene

The repository ignores common generated artifacts such as:

- `node_modules`
- Next.js build output
- Rust `target/`
- local env files
- logs and TypeScript build info

## Suggested workflow

1. Configure `frontend/.env.local`
2. Run `npm run dev`
3. Connect a wallet
4. Open `Launch` and publish a listing
5. Review it in `Explore`
6. Purchase it from a second wallet
7. Open `Library` with the publishing wallet to finalize delivery if needed
8. Open `Library` with the purchasing wallet to reveal and download

## License

MIT
