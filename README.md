# Arxcess

**Encrypted digital goods marketplace on Solana + Arcium.** Sellers never see the buyer’s decrypted content; Arcium MXE handles custody and delivery via verifiable confidential compute.

---

## Table of contents

- [How it works](#how-it-works)
- [Judge quick start](#judge-quick-start)
- [Repository structure](#repository-structure)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Frontend surfaces](#frontend-surfaces)
- [Solana program](#solana-program)
- [Arcium integration](#arcium-integration)
- [Supabase sync](#supabase-sync)
- [Verifying on-chain state](#verifying-on-chain-state)
- [Development workflow](#development-workflow)
- [Security & privacy notes](#security--privacy-notes)
- [License](#license)

---

## How it works

The core protocol separates encryption, custody, and delivery into distinct on-chain steps:

| Step | Actor | Action |
|------|-------|--------|
| 1 | Seller | Encrypts file locally (AES-GCM in-browser), uploads ciphertext to Pinata/IPFS |
| 2 | Seller | Calls `create_product` + `request_deposit_product_key` → queues Arcium MXE computation to wrap the content key under MXE custody |
| 3 | Arcium | Callback sets `arcium_custody_ready = true` on [`ProductState`](contracts/programs/arxcess/src/state/product_state.rs) |
| 4 | Buyer | Calls `purchase_product` on-chain, auto-generates a delivery keypair in-browser |
| 5 | Seller | Calls `request_evaluate_and_seal` → queues Arcium computation to re-encrypt the content key under the buyer's delivery public key |
| 6 | Arcium | Callback writes encrypted payload into [`PurchaseState`](contracts/programs/arxcess/src/state/purchase_state.rs), sets `arcium_delivery_ready = true` |
| 7 | Buyer | Reads on-chain payload, decrypts with their delivery private key, previews and downloads in-browser |

The seller never touches the buyer's decrypted content. Arcium's MXE network performs the re-encryption in a confidential compute environment — the result is cryptographically verifiable on-chain.

### Architecture at a glance

- **On-chain program** (Anchor): product lifecycle + purchase lifecycle + Arcium callbacks
- **Confidential compute** (Arcium MXE): custody wrap + buyer-specific re-encrypt
- **Client** (Next.js): Launch (seller), Explore (buyer), Library (reveal/delivery)
- **Storage**: Pinata/IPFS for ciphertext + metadata; optional Supabase for shared listings/purchases; `localStorage` fallback
- **Keys**: Seller content key never leaves browser; buyer delivery keypair auto-generated in-browser; Arcium wraps/unwraps without exposing plaintext

### Judge quick start

- **Run locally:** `npm install && npm run dev` → http://localhost:3000
- **Env:** use `.env.example` as template; Pinata JWT required for Launch uploads; Supabase optional
- **Test flow (two wallets):**
  1) Wallet A (seller) → Launch → publish listing → wait custody ready
  2) Wallet B (buyer) → Explore → buy listing (stores purchase intent)
  3) Wallet A → Library → Finalize delivery (queues Arcium evaluate_and_seal)
  4) Wallet B → Library → Reveal → Download (after `arcium_delivery_ready=true`)
- **Verify:** open Publish/Delivery tx links in Library → Solana Explorer; see Arcium CPI + events

---

## Repository structure

```text
arxcess/
├── frontend/               # Next.js 14 app (Home, Explore, Launch, Library)
│   ├── app/                # Next.js App Router pages and API routes
│   ├── components/         # React components (purchase/, upload/, ui/, marketplace/)
│   ├── hooks/              # Custom React hooks (use-purchases, use-products)
│   ├── lib/                # Client utilities (arcium, anchor, solana, supabase, crypto, ipfs)
│   └── .env.local          # Local environment config (not committed)
├── sdk/ts/                 # Shared TypeScript SDK (@arxcess/sdk)
├── contracts/              # Anchor workspace
│   ├── Anchor.toml         # Anchor config
│   └── programs/arxcess/   # Solana program source (Rust)
├── encrypted-ixs/          # Arcium circuit definitions (Rust)
├── build/                  # Compiled Arcium circuit interface files (.idarc)
├── scripts/                # CLI smoke-test scripts
├── supabase/               # Supabase SQL schema files
├── Cargo.toml              # Rust workspace manifest
└── package.json            # npm workspace root
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TypeScript, TailwindCSS |
| Wallet | Solana Wallet Adapter, `@coral-xyz/anchor` |
| On-chain | Solana Devnet, Anchor program |
| Confidential compute | Arcium MXE (live on Devnet) |
| Storage | Pinata/IPFS (ciphertext + metadata JSON) |
| Shared state (optional) | Supabase (listings + purchase history) |
| Crypto (client) | AES-GCM in-browser via Web Crypto API |

---

## Getting started

### Prerequisites

- Node.js 20+, npm 10+
- (For contract work) Rust toolchain, Solana CLI, Anchor CLI

### Install and run

```bash
# From the repo root — installs all npm workspace dependencies
npm install

# Start the frontend dev server
npm run dev
# → http://localhost:3000
```

### Available scripts

```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (zero errors required)
```

---

## Environment variables

Create `frontend/.env.local` (never commit this file):

```env
# Solana
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=sDNRRyCwQptaRZHATCha4nSJCFCwpcDWH2NvJCCAwFk
NEXT_PUBLIC_TREASURY_WALLET=<your_devnet_treasury_pubkey>

# Pinata (required for Launch uploads)
PINATA_JWT=<your_pinata_jwt>

# Supabase (optional — enables shared listing and purchase history)
NEXT_PUBLIC_SUPABASE_URL=<your_supabase_project_url>
SUPABASE_SERVICE_ROLE_KEY=<your_supabase_service_role_key>
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Yes | Solana JSON-RPC endpoint |
| `NEXT_PUBLIC_PROGRAM_ID` | Yes | On-chain Arxcess program address |
| `NEXT_PUBLIC_TREASURY_WALLET` | Yes | Protocol fee destination for `create_product` and `purchase_product` |
| `PINATA_JWT` | For Launch | Authenticated Pinata uploads (ciphertext + metadata) |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Enables cross-browser listing and purchase sync |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-side Supabase writes via API routes |

A template with all keys is provided in [`.env.example`](.env.example).

---

## Frontend surfaces

### Home — [`frontend/app/page.tsx`](frontend/app/page.tsx)

Landing page. Introduces the encrypted marketplace model and routes users to the correct workflow based on their role (buyer or seller).

### Explore — [`frontend/components/purchase/product-catalog.tsx`](frontend/components/purchase/product-catalog.tsx)

Searchable, filterable storefront of active listings.

- Displays listings with category icon, title, description, price, reveal limit, and license duration
- Red badge for revocable listings
- Checkout triggers `purchase_product` on-chain; delivery keypair is auto-generated in-browser
- Purchase intent stored locally (and synced to Supabase if configured)

### Launch — [`frontend/components/upload/seller-workbench.tsx`](frontend/components/upload/seller-workbench.tsx)

Step-by-step seller workspace for publishing encrypted listings.

1. Fill listing metadata (title, description, category, price, license duration, reveal limit, revocable flag)
2. Select file — encrypted in-browser with AES-GCM via Web Crypto API
3. Ciphertext and metadata uploaded to Pinata/IPFS
4. Three wallet-signed transactions:
   - `create_product` — registers the listing on-chain
   - `request_deposit_product_key` — queues Arcium MXE custody computation
   - `activate_product` — activates after Arcium callback settles
5. Listing stored locally and optionally synced to Supabase

### Library — [`frontend/components/purchase/purchases-list.tsx`](frontend/components/purchase/purchases-list.tsx)

Wallet-gated hub for buyers and sellers. Shows two tabs:

**Assets tab** — active purchases with delivery state

| Action | Available to |
|--------|-------------|
| Finalize delivery | Seller wallet only (triggers `request_evaluate_and_seal`) |
| Reveal | Buyer wallet, after `arcium_delivery_ready = true` |
| Download | Buyer wallet, after a successful reveal |
| Revoke access | Seller wallet, if listing is marked revocable |

Each asset card shows delivery status, reveal count, purchase date, expiry, and an expandable transaction trail (Purchase tx, Publish tx, Delivery tx).

**History tab** — full chronological purchase history with expandable transaction details per entry.

---

## Solana program

Source: [`contracts/programs/arxcess/`](contracts/programs/arxcess/)

Key instructions:

| Instruction | Description |
|-------------|-------------|
| `create_product` | Initializes `ProductState` on-chain |
| `request_deposit_product_key` | Queues Arcium computation to wrap content key under MXE custody |
| `activate_product` | Marks listing as active after custody callback settles |
| `purchase_product` | Initializes `PurchaseState`, records buyer delivery pubkey |
| `request_evaluate_and_seal` | Queues Arcium computation to re-encrypt content key for buyer |
| `revoke_purchase` | Revokes buyer access (seller only, revocable listings) |

Key state accounts:

| Account | File | Description |
|---------|------|-------------|
| `ProductState` | [`state/product_state.rs`](contracts/programs/arxcess/src/state/product_state.rs) | Listing metadata, Arcium custody flags, ciphertext material |
| `PurchaseState` | [`state/purchase_state.rs`](contracts/programs/arxcess/src/state/purchase_state.rs) | Buyer delivery key, encrypted payload, delivery flags |

Anchor workspace config: [`contracts/Anchor.toml`](contracts/Anchor.toml)

```bash
# Run Anchor tests (requires Rust + Solana + Anchor CLI)
anchor test
```

---

## Arcium integration

Arcium circuit definitions: [`encrypted-ixs/src/lib.rs`](encrypted-ixs/src/lib.rs)

| Circuit | Purpose |
|---------|---------|
| `deposit_key_v3` | Wraps seller content key under Arcium MXE custody |
| `evaluate_and_seal_v4` | Re-encrypts content key under buyer delivery public key |

The circuits are compiled to `.idarc` interface files in [`build/`](build/). The Anchor program references these offsets at instruction time.

Arcium computation is **live on Devnet**. Every publish and delivery goes through real MXE nodes — no mocking.

---

## Supabase sync

Supabase is optional. When `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set:

- Listings published via Launch are synced to the `active_listings` table
- Purchases made via Explore are synced to the `purchases` table
- Library and Explore fetch from Supabase first, falling back to `localStorage`

SQL schema files: [`supabase/`](supabase/)

API routes (server-side):

| Route | File |
|-------|------|
| `GET/POST /api/listings` | [`frontend/app/api/listings/route.ts`](frontend/app/api/listings/route.ts) |
| `GET/POST /api/purchases` | [`frontend/app/api/purchases/route.ts`](frontend/app/api/purchases/route.ts) |

Without Supabase, all state is browser-local to `localStorage`. Cross-browser and cross-device visibility requires Supabase.

---

## Verifying on-chain state

### Via Solana Explorer

After publishing or finalizing delivery, the Library shows **Publish tx** and **Delivery tx** links in the transaction trail. Open them on [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet) and look for:

- CPI calls to the Arcium program (`arcMXE...`)
- Anchor events: `ArciumProductKeyComputationRequested`, `ArciumProductKeySettled`, `ArciumDeliverySettled`

### Via CLI

```bash
# Read raw ProductState account data
solana account <PRODUCT_STATE_PUBKEY> --url devnet --output json | \
  node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const buf = Buffer.from(d.account.data[0], 'base64');
// See contracts/programs/arxcess/src/state/product_state.rs for field layout
console.log('raw hex:', buf.toString('hex').slice(0, 160));
"
```

### Via smoke-test script

```bash
node scripts/smoke-arcium-flow.mjs
```

The script runs the full end-to-end flow:

1. Creates a product → calls `request_deposit_product_key` → prints `custody_tx`
2. Polls until `arcium_custody_ready = true` on `ProductState`
3. Creates a purchase → calls `request_evaluate_and_seal` → prints `delivery_tx`
4. Polls until `arcium_delivery_ready = true` on `PurchaseState`
5. Decrypts on-chain payload and asserts the commitment hash matches original content

A passing run is cryptographic proof that Arcium performed real confidential computation.

---

## Security & privacy notes

- **Client-side encryption:** Content encrypted in-browser; seller content key never leaves the client.
- **Confidential compute:** Arcium MXE performs custody/delivery under BLS-signed outputs; callbacks verified on-chain.
- **Buyer-bound delivery:** Delivery payload is encrypted to the buyer’s delivery pubkey; unusable by others.
- **Revocation:** `revoke_purchase` blocks future reveals when listing is marked revocable.
- **Storage surface:** Ciphertext + metadata only on IPFS/Pinata; plaintext never stored server-side.
- **Optional Supabase:** Holds only listing metadata + purchase intents (no plaintext keys/ciphertext); guarded by service role key in API routes.

---

## Development workflow

```
1. Configure frontend/.env.local (see Environment variables above)
2. npm run dev
3. Connect a Devnet wallet (e.g. Phantom in Devnet mode)
4. Open Launch → publish a listing
5. Open Explore → buy the listing from a second wallet
6. Open Library with the seller wallet → Finalize delivery
7. Open Library with the buyer wallet → Reveal and Download
```

For type safety, always run `npm run typecheck` before pushing.

---

## License

MIT
