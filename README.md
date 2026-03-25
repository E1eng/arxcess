# Arxcess

> **Private Data Transfer & Access Control  -  Encrypted digital goods marketplace built on Solana + Arcium.**

Apps need cryptographic access control without trusted servers. With Arcium, keys, policies, metering, and licensing are enforced in encrypted shared state over arbitrary storage (IPFS/S3), enabling revocation, pay-to-decrypt, and time-bound access.

Arxcess brings this directly to digital commerce: sellers publish encrypted files to IPFS, Arcium's MXE confidential compute network takes custody of the content key, and buyers receive buyer-bound re-encrypted delivery payloads  -  all verifiable on Solana Devnet with zero server trust.

---

## Table of Contents

- [Why Arxcess](#why-arxcess)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Tech Stack](#tech-stack)
- [Arcium Integration](#arcium-integration)
- [Solana Program](#solana-program)
- [Frontend Surfaces](#frontend-surfaces)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Supabase (Optional)](#supabase-optional)
- [Verifying On-Chain State](#verifying-on-chain-state)
- [Security & Privacy](#security--privacy)
- [Development Workflow](#development-workflow)
- [Judging Notes](#judging-notes)
- [Team](#team)
- [License](#license)

---

## Why Arxcess

Traditional digital marketplaces require buyers to trust the platform to deliver what they paid for, and sellers to trust the platform not to leak their content. Both parties implicitly trust a centralized server.

Arxcess eliminates that trust requirement:

- **No trusted server for decryption.** The content key is never stored on any server. Arcium's MXE network  -  a network of confidential compute nodes  -  holds it under encrypted shared state.
- **Buyer-bound delivery.** Arcium re-encrypts the content key specifically for the buyer's ephemeral delivery keypair, generated in-browser at checkout. The re-encrypted payload lives on-chain  -  no courier, no intermediary.
- **Policy enforcement in confidential compute.** Payment verification, product status, revocation status, and delivery finality are all evaluated inside the Arcium circuit before any key material is released.
- **Verifiable on Solana.** Every custody and delivery event emits Anchor events and on-chain state transitions that anyone can inspect on Solana Explorer.

---

## How It Works

The core protocol separates encryption, custody, and delivery into distinct on-chain steps:

| Step | Actor | Action |
|------|-------|--------|
| 1 | Seller | Encrypts file in-browser (AES-GCM, Web Crypto API), uploads ciphertext to Pinata/IPFS |
| 2 | Seller | Signs `create_product` → registers listing on-chain with ciphertext CID and hash |
| 3 | Seller | Signs `request_deposit_product_key` → encrypts content key + IV to the Arcium MXE public key using Rescue cipher over x25519 shared secret, queues confidential compute job |
| 4 | Arcium MXE | Executes `deposit_key_v3` circuit, verifies inputs, stores key under MXE custody, fires `deposit_key_v3_callback` → sets `arcium_custody_ready = true` on `ProductState` |
| 5 | Seller | Signs `activate_product` → listing becomes publicly purchasable |
| 6 | Buyer | Generates ephemeral x25519 delivery keypair in-browser, signs `purchase_product` → payment transferred on-chain, delivery pubkey recorded in `PurchaseState` |
| 7 | Seller | Signs `request_evaluate_and_seal` → triggers Arcium `evaluate_and_seal_v4` circuit |
| 8 | Arcium MXE | Evaluates all policy conditions (payment verified, product active, not revoked, not yet delivered), re-encrypts content key to buyer's delivery pubkey, fires `evaluate_and_seal_v4_callback` → writes ciphertext payload into `PurchaseState`, sets `arcium_delivery_ready = true` |
| 9 | Buyer | Reads on-chain ciphertext payload, decrypts using delivery private key + Arcium MXE shared secret via Rescue cipher, recovers content key + IV, downloads and decrypts the IPFS ciphertext |

**The seller never has access to the buyer's decrypted content. Arcium's MXE network performs the re-encryption inside a confidential compute environment  -  the result is cryptographically verifiable on-chain.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Seller)                         │
│  AES-GCM encrypt file → upload ciphertext to IPFS/Pinata        │
│  Rescue-encrypt content key + IV → MXE x25519 public key        │
│  Sign: create_product, request_deposit_product_key,             │
│        activate_product                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Solana transactions
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SOLANA PROGRAM (Anchor)                       │
│  ProductState  ←  create_product, activate_product              │
│  PurchaseState ←  purchase_product, finalize_delivery           │
│  Arcium CPIs:  request_deposit_product_key                      │
│                request_evaluate_and_seal                        │
│  Callbacks:    deposit_key_v3_callback                          │
│                evaluate_and_seal_v4_callback                    │
└──────────┬──────────────────────────────────┬───────────────────┘
           │ CPI to Arcium                    │ Callbacks
           ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ARCIUM MXE NETWORK                           │
│  deposit_key_v3:     custody wrap (key → MXE encrypted state)   │
│  evaluate_and_seal_v4: policy check + re-encrypt to buyer pubkey│
│  BLS-signed outputs, on-chain delivery commitment verified      │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼ arcium_delivery_ready = true
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (Buyer)                          │
│  Read PurchaseState ciphertexts from chain                      │
│  Decrypt via delivery keypair + MXE public key (Rescue cipher)  │
│  Recover content key + IV → decrypt IPFS ciphertext             │
│  Preview / Download decrypted file                              │
└─────────────────────────────────────────────────────────────────┘
```

**Storage layer**  -  Ciphertext and metadata JSON are stored on Pinata/IPFS. Supabase (optional) holds listing metadata and purchase intents for cross-browser discoverability. `localStorage` is the fallback for single-browser use.

---

## Repository Structure

```text
arxcess/
├── frontend/                    # Next.js 14 application
│   ├── app/                     # App Router pages and API routes
│   │   ├── page.tsx             # Home / landing page
│   │   ├── explore/             # Explore (buyer storefront)
│   │   ├── launch/              # Launch (seller workbench)
│   │   ├── library/             # Library (purchases + delivery)
│   │   └── api/
│   │       ├── listings/        # GET/POST listings (Supabase-backed)
│   │       └── purchases/       # GET/POST purchases (Supabase-backed)
│   ├── components/
│   │   ├── marketplace/         # AppShell, TopBar layout
│   │   ├── purchase/            # ProductCatalog (Explore), PurchasesList (Library)
│   │   ├── upload/              # SellerWorkbench (Launch)
│   │   └── ui/                  # Button, Input, Badge, etc.
│   ├── hooks/                   # use-purchases, use-products, use-delivery-keys
│   └── lib/
│       ├── arcium/              # Arcium client: prepare custody, decrypt delivery
│       ├── anchor/              # Anchor provider + program helpers
│       ├── crypto/              # content.ts (AES-GCM), delivery.ts (x25519 keypair)
│       ├── ipfs/                # Pinata upload client
│       ├── solana/              # RPC helpers, transaction utilities
│       ├── supabase/            # Supabase client (listings, purchases)
│       └── storage/             # Marketplace listing storage abstraction
├── sdk/ts/                      # Shared TypeScript types (@arxcess/sdk)
├── contracts/
│   ├── Anchor.toml              # Anchor workspace config
│   └── programs/arxcess/src/
│       ├── lib.rs               # Program entry point + instruction routing
│       ├── state/
│       │   ├── product_state.rs # ProductState account layout
│       │   └── purchase_state.rs# PurchaseState account layout
│       ├── instructions/        # One file per instruction handler
│       ├── errors.rs            # Custom error codes
│       └── events.rs            # Anchor event definitions
├── encrypted-ixs/src/           # Arcium circuit definitions (Rust + arcis)
│   ├── lib.rs                   # deposit_key_v3, evaluate_and_seal_v4 circuits
│   ├── deposit_key.rs           # Vault handle + key commitment derivation
│   └── evaluate_and_seal.rs     # Policy evaluation + buyer-bound sealing
├── build/                       # Compiled Arcium circuit interface files (.idarc)
├── scripts/                     # CLI smoke-test: smoke-arcium-flow.mjs
├── supabase/                    # SQL schema files
├── Cargo.toml                   # Rust workspace manifest
├── Arcium.toml                  # Arcium cluster config (devnet offset 456)
└── package.json                 # npm workspace root
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React 18, TypeScript, TailwindCSS |
| Wallet | Solana Wallet Adapter, `@coral-xyz/anchor` |
| On-chain program | Solana Devnet, Anchor 0.32.1 |
| Confidential compute | **Arcium MXE** (live on Devnet) |
| Arcium client SDK | `@arcium-hq/client` (x25519, Rescue cipher, MXE pubkey fetch) |
| Storage | Pinata/IPFS (ciphertext + metadata JSON) |
| Client-side crypto | Web Crypto API  -  AES-GCM 256-bit |
| Delivery keypair | TweetNaCl x25519 key generation |
| Shared state (optional) | Supabase (listings + purchase history) |

---

## Arcium Integration

Arcium is the core privacy layer of Arxcess. It replaces the need for a trusted key-management server by performing cryptographic operations inside a Multi-Party Execution (MXE) confidential compute network.

### Circuits

Defined in [`encrypted-ixs/src/lib.rs`](encrypted-ixs/src/lib.rs):

#### `deposit_key_v3`  -  Custody Wrap

```rust
pub fn deposit_key_v3(input_ctxt: Enc<Shared, DeliveryMaterial>) -> Enc<Mxe, DeliveryMaterial>
```

- **Input:** `DeliveryMaterial` (content key + IV, 44 bytes) encrypted by the seller using the MXE x25519 public key
- **Output:** Same material re-encrypted under MXE custody
- **Effect:** Content key is now held exclusively in Arcium's encrypted shared state; the seller's one-time encryption key is discarded

#### `evaluate_and_seal_v4`  -  Policy Check + Buyer Re-encryption

```rust
pub fn evaluate_and_seal_v4(
    input_ctxt: Enc<Shared, DeliveryMaterial>,
    payment_verified: bool,
    product_active: bool,
    purchase_not_revoked: bool,
    delivery_not_yet_finalized: bool,
    buyer: Shared,
) -> (bool, Enc<Shared, DeliveryMaterial>)
```

- **Input:** MXE-encrypted delivery material + four on-chain policy flags + buyer delivery pubkey
- **Policy:** All four conditions must be true; if any fails, a zero payload is re-encrypted instead
- **Output:** `(approval_flag, buyer-encrypted DeliveryMaterial)`
- **Effect:** If approved, buyer can decrypt the content key using only their delivery private key

### How the Arcium Client Works (Frontend)

Located in [`frontend/lib/arcium/client.ts`](frontend/lib/arcium/client.ts):

**Publish path (`prepareListingCustody`):**
1. Fetches MXE x25519 public key from chain via `getMXEPublicKey`
2. Packs content key + IV into 44-byte `DeliveryMaterial`
3. Generates a one-time x25519 keypair, derives shared secret with MXE pubkey
4. Encrypts material using Rescue cipher with a random 16-byte nonce
5. Returns `sellerEncryptionPublicKey`, `encryptedKeyCiphertexts`, `encryptedKeyNonce`  -  passed to `request_deposit_product_key`

**Reveal path (`revealArciumDeliveryMaterial`):**
1. Reads `arcium_delivery_encryption_key`, `arcium_delivery_nonce`, `arcium_delivery_ciphertexts` from `PurchaseState`
2. Verifies the encryption key matches the buyer's delivery public key (ownership check)
3. Derives shared secret between buyer delivery private key and MXE public key
4. Decrypts using Rescue cipher → recovers 44-byte `DeliveryMaterial`
5. Unpacks content key + IV → used to AES-GCM decrypt the IPFS ciphertext

### On-Chain Callbacks

```rust
#[arcium_callback(encrypted_ix = "deposit_key_v3", auto_serialize = false)]
pub fn deposit_key_v3_callback(...) -> Result<()>

#[arcium_callback(encrypted_ix = "evaluate_and_seal_v4", auto_serialize = false)]
pub fn evaluate_and_seal_v4_callback(...) -> Result<()>
```

Callbacks are called by the Arcium program after computation completes. They write the output into `ProductState` or `PurchaseState` and set the `arcium_custody_ready` / `arcium_delivery_ready` flags.

### Privacy Benefits

| Property | Mechanism |
|----------|-----------|
| Content key never exposed server-side | AES-GCM encryption happens in-browser; key is handed to Arcium MXE, never to a backend |
| Seller cannot read buyer's delivery | Re-encryption is done by Arcium MXE, not the seller; seller only queues the computation |
| Buyer delivery is bound to one keypair | MXE encrypts to buyer's x25519 public key recorded at purchase time; the payload is useless without the matching private key |
| Policy enforced in confidential compute | Payment, status, revocation, and delivery flags are checked inside the Arcium circuit  -  not in client-side JavaScript or a server |
| Delivery commitment verifiable on-chain | `delivery_commitment` is a SHA-256 hash over all delivery inputs; published on-chain and can be independently verified |
| Revocation | Seller can call `revoke_purchase` on revocable listings; the circuit checks `purchase_not_revoked` before releasing key material |
| Time-bound access | `expires_at` and `max_access_count` enforced in `consume_access` on-chain |

---

## Solana Program

Program ID: `sDNRRyCwQptaRZHATCha4nSJCFCwpcDWH2NvJCCAwFk`

Source: [`contracts/programs/arxcess/src/`](contracts/programs/arxcess/src/)

### Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `create_product` | Seller | Initializes `ProductState` with listing metadata, ciphertext CID/hash, price, license params |
| `request_deposit_product_key` | Seller | Encrypts content key + IV to MXE; queues Arcium `deposit_key_v3` computation |
| `deposit_key_v3_callback` | Arcium | Sets `arcium_custody_ready = true`, stores vault handle and key commitment |
| `activate_product` | Seller | Transitions listing from Draft → Active after custody is ready |
| `pause_product` | Seller | Pauses an active listing |
| `purchase_product` | Buyer | Initializes `PurchaseState`; transfers payment on-chain; records buyer delivery pubkey |
| `request_evaluate_and_seal` | Seller | Queues Arcium `evaluate_and_seal_v4` computation for a specific purchase |
| `evaluate_and_seal_v4_callback` | Arcium | Writes delivery ciphertext into `PurchaseState`; sets `arcium_delivery_ready = true` |
| `consume_access` | Buyer | Increments `access_count`, enforces expiry and reveal limit |
| `revoke_purchase` | Seller | Revokes buyer access on revocable listings |

### Key State Accounts

**`ProductState`** ([`state/product_state.rs`](contracts/programs/arxcess/src/state/product_state.rs))

Stores listing metadata plus Arcium custody state:
- `ciphertext_cid`, `ciphertext_hash`  -  IPFS location and integrity hash of the encrypted file
- `arcium_vault_handle`, `key_commitment`  -  identifiers for MXE custody
- `arcium_key_nonce`, `arcium_key_ciphertexts`  -  MXE-encrypted delivery material
- `arcium_custody_ready`  -  set to `true` by the `deposit_key_v3` callback
- `license_duration_seconds`, `max_access_count`, `revocable`  -  access policy

**`PurchaseState`** ([`state/purchase_state.rs`](contracts/programs/arxcess/src/state/purchase_state.rs))

Stores purchase and delivery state:
- `buyer_delivery_pubkey`  -  buyer's x25519 public key recorded at checkout
- `sealed_key_box`  -  Arcium-encrypted delivery payload
- `arcium_delivery_encryption_key`, `arcium_delivery_nonce`, `arcium_delivery_ciphertexts`  -  Arcium Rescue-cipher output
- `delivery_commitment`  -  on-chain SHA-256 commitment over all delivery inputs
- `arcium_delivery_ready`  -  set to `true` by the `evaluate_and_seal_v4` callback
- `access_count`, `max_access_count`, `expires_at`, `revoked_at`  -  entitlement tracking

---

## Frontend Surfaces

### Home  -  [`frontend/app/page.tsx`](frontend/app/page.tsx)

Landing page. Introduces the encrypted marketplace concept, outlines the seller and buyer workflows, and links to Launch and Explore.

### Explore  -  [`frontend/components/purchase/product-catalog.tsx`](frontend/components/purchase/product-catalog.tsx)

Searchable, filterable storefront of active listings.

- Listings pulled from Supabase (or `localStorage` fallback)
- Filter by category, search by title, sort by price/date/popularity
- Each card shows price, reveal limit, license duration, and revocability badge
- **Checkout:** triggers `purchase_product` on-chain; buyer delivery keypair auto-generated in-browser and stored in `localStorage` keyed by purchase ID

### Launch  -  [`frontend/components/upload/seller-workbench.tsx`](frontend/components/upload/seller-workbench.tsx)

Step-by-step seller workspace for publishing encrypted listings.

1. Fill metadata: title, description, category, price (SOL), license duration, reveal limit, revocable flag
2. Select file → AES-GCM encrypted in-browser via Web Crypto API
3. Ciphertext + metadata JSON uploaded to Pinata/IPFS
4. Three sequential wallet transactions:
   - `create_product`  -  registers product on-chain
   - `request_deposit_product_key`  -  queues Arcium MXE custody; passes Rescue-encrypted content key
   - `activate_product`  -  activates listing after custody settles
5. Listing synced to Supabase and/or `localStorage`

### Library  -  [`frontend/components/purchase/purchases-list.tsx`](frontend/components/purchase/purchases-list.tsx)

Wallet-gated hub showing all purchases associated with the connected wallet.

**Assets tab**  -  active purchases with delivery state:

| Action | Shown To | Condition |
|--------|----------|-----------|
| Finalize delivery | Seller | Purchase exists, delivery not yet sent |
| Reveal | Buyer | `arcium_delivery_ready = true` |
| Download | Buyer | After successful reveal |
| Revoke | Seller | Listing marked revocable |

Each card shows: delivery status, reveal count (`used/max`), price, purchase date, expiry, and expandable transaction trail (Purchase tx, Publish tx, Delivery tx).

**History tab**  -  full chronological purchase history with expandable per-entry transaction details.

---

## Getting Started

### Prerequisites

- **Node.js 20+**, npm 10+
- A Solana wallet extension (e.g. [Phantom](https://phantom.app/)) set to **Devnet**
- Devnet SOL  -  get some from the [Solana faucet](https://faucet.solana.com/)
- A [Pinata](https://pinata.cloud/) account for IPFS uploads (free tier works)
- (Optional) A [Supabase](https://supabase.com/) project for cross-browser listing/purchase sync

> For smart contract development only: Rust toolchain, Solana CLI, Anchor CLI 0.32.1

### Install & Run

```bash
# Clone the repository
git clone https://github.com/your-org/arxcess.git
cd arxcess

# Install all npm workspace dependencies (frontend + SDK)
npm install

# Configure environment (see Environment Variables below)
cp frontend/.env.example frontend/.env.local
# Edit frontend/.env.local with your values

# Start the development server
npm run dev
# → http://localhost:3000
```

### Available Scripts

```bash
npm run dev           # Start Next.js dev server
npm run build         # Production build (frontend)
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit (must pass with zero errors)

# Contract / Arcium scripts (requires full Rust + Anchor + Arcium CLI setup)
npm run build:anchor  # Build Anchor program
npm run build:arcium  # Build Arcium circuits → .idarc files
npm run test:arcium   # Run Arcium circuit tests on devnet
```

---

## Environment Variables

Create `frontend/.env.local`  -  **never commit this file**:

```env
# Solana
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=sDNRRyCwQptaRZHATCha4nSJCFCwpcDWH2NvJCCAwFk
NEXT_PUBLIC_TREASURY_WALLET=<your_devnet_treasury_pubkey>

# Arcium
NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=456

# Pinata (required for Launch uploads)
PINATA_JWT=<your_pinata_jwt>

# Supabase (optional  -  enables shared listing and purchase history)
NEXT_PUBLIC_SUPABASE_URL=<your_supabase_project_url>
SUPABASE_SERVICE_ROLE_KEY=<your_supabase_service_role_key>
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Yes | Solana JSON-RPC endpoint |
| `NEXT_PUBLIC_PROGRAM_ID` | Yes | On-chain Arxcess program address |
| `NEXT_PUBLIC_TREASURY_WALLET` | Yes | Protocol fee destination |
| `NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET` | Yes | Arcium devnet cluster offset (456)  -  required for publish and delivery finalization |
| `PINATA_JWT` | For Launch | Authenticated Pinata uploads (ciphertext + metadata) |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Enables cross-browser listing and purchase sync |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-side Supabase writes via API routes |

---

## Supabase (Optional)

When `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set:

- Listings published via Launch are persisted to the `listings` table
- Purchases made via Explore are persisted to the `purchases` table
- Library and Explore query Supabase first, falling back to `localStorage`

SQL schema files: [`supabase/`](supabase/)

Server-side API routes:

| Route | File | Description |
|-------|------|-------------|
| `GET /api/listings` | [`frontend/app/api/listings/route.ts`](frontend/app/api/listings/route.ts) | Fetch all active listings |
| `POST /api/listings` | same | Persist a new listing |
| `GET /api/purchases` | [`frontend/app/api/purchases/route.ts`](frontend/app/api/purchases/route.ts) | Fetch purchases by wallet |
| `POST /api/purchases` | same | Persist a new purchase record |

Without Supabase, state is fully browser-local via `localStorage`. Cross-browser and cross-device visibility requires Supabase.

---

## Verifying On-Chain State

### Via Solana Explorer

After publishing or finalizing delivery, the Library shows **Publish tx** and **Delivery tx** links. Open them on [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet) and inspect:

- CPI calls to the Arcium program
- Anchor events: `ArciumProductKeyComputationRequested`, `ArciumProductKeySettled`, `ArciumDeliverySettled`

### Via CLI

```bash
# Read raw ProductState account
solana account <PRODUCT_STATE_PUBKEY> --url devnet --output json | \
  node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const buf = Buffer.from(d.account.data[0], 'base64');
console.log('raw hex:', buf.toString('hex').slice(0, 160));
"
```

### Via Smoke-Test Script

```bash
node scripts/smoke-arcium-flow.mjs
```

The script runs a full end-to-end Arcium flow:

1. Creates a product → calls `request_deposit_product_key` → prints `custody_tx`
2. Polls until `arcium_custody_ready = true` on `ProductState`
3. Creates a purchase → calls `request_evaluate_and_seal` → prints `delivery_tx`
4. Polls until `arcium_delivery_ready = true` on `PurchaseState`
5. Decrypts on-chain payload and asserts the commitment hash matches the original content

A passing run is cryptographic proof that Arcium performed real confidential computation on Devnet.

---

## Security & Privacy

| Property | Implementation |
|----------|---------------|
| In-browser encryption | `window.crypto.subtle` AES-GCM 256-bit; content key is never sent to any server |
| Arcium MXE custody | Content key + IV packed into 44-byte `DeliveryMaterial`, encrypted to MXE x25519 pubkey using Rescue cipher over ECDH shared secret; MXE holds it under encrypted shared state |
| Buyer-bound re-encryption | Arcium circuit re-encrypts delivery material exclusively to the buyer's x25519 public key recorded at `purchase_product` time |
| On-chain delivery commitment | `delivery_commitment` is SHA-256 over `(product_id, purchase_id, buyer_pubkey, buyer_delivery_pubkey, approval_flag, sealed_key_box)`  -  written on-chain and verifiable by anyone |
| Policy enforcement | Payment, product status, revocation, and delivery finality evaluated inside the Arcium circuit  -  not in JavaScript or a server |
| Revocation | Seller can call `revoke_purchase` on revocable listings; future `evaluate_and_seal` calls will output a zero payload |
| Time-bound access | `expires_at` enforced in `consume_access`; `max_access_count` limits total reveals |
| Supabase stores no secrets | Supabase holds only listing metadata and purchase intents (no content keys, no ciphertext); guarded by service role key in server-side API routes |

---

## Development Workflow

```
1.  Configure frontend/.env.local
2.  npm run dev  →  http://localhost:3000
3.  Connect Phantom (Devnet mode)  -  get Devnet SOL from faucet
4.  Open Launch (Wallet A / seller):
      - Fill metadata, select a file, click Publish
      - Approve 3 wallet transactions: create_product, request_deposit_product_key, activate_product
      - Wait for Arcium custody callback (arcium_custody_ready = true on-chain)
5.  Open Explore (Wallet B / buyer):
      - Find the listing, click Buy
      - Approve purchase_product transaction
6.  Open Library (Wallet A / seller):
      - Find the purchase, click Finalize delivery
      - Approve request_evaluate_and_seal transaction
      - Wait for Arcium delivery callback (arcium_delivery_ready = true on-chain)
7.  Open Library (Wallet B / buyer):
      - Find the asset, click Reveal → Download
```

Run `npm run typecheck` before every push  -  zero TypeScript errors required.

---

## Judging Notes

This project was built as a submission for the **Private Data Transfer & Access Control** track.

### Requirements Checklist

- [x] **Functional Solana project integrated with Arcium**  -  Program deployed on Devnet at `sDNRRyCwQptaRZHATCha4nSJCFCwpcDWH2NvJCCAwFk`; Arcium circuits live on Devnet (cluster offset 456); full publish + delivery flow executed via real MXE nodes
- [x] **Clear explanation of how Arcium is used and the privacy benefits it provides**  -  See [Arcium Integration](#arcium-integration) above
- [x] **Open-source GitHub repository**  -  This repository
- [x] **Submission in English**  -  All documentation and UI in English

### Judging Criteria Alignment

| Criterion | Implementation |
|-----------|---------------|
| **Innovation** | Trustless pay-to-decrypt marketplace  -  buyers receive content keys re-encrypted by Arcium MXE, eliminating server-side trust entirely |
| **Technical Implementation** | End-to-end Arcium integration with custom circuit logic, Anchor callbacks, x25519/Rescue cipher key transport, and on-chain commitment verification |
| **User Experience** | Single-flow marketplace: seller publishes in 3 clicks, buyer purchases in 1 click, delivery and reveal handled from the Library |
| **Impact** | Applicable to digital goods, research data, media licensing, and any scenario requiring cryptographic access control without a trusted key server |
| **Clarity** | README covers full architecture, Arcium circuit logic, privacy properties, and a step-by-step test flow for judges |

### Quick Judge Flow (Two Wallets)

```
1. Wallet A → Launch → publish any file → wait for custody ready
2. Wallet B → Explore → buy the listing
3. Wallet A → Library → Finalize delivery
4. Wallet B → Library → Reveal → Download
5. Click any tx link → Solana Explorer → verify Arcium CPI + events
```

---

## Team

| Handle |  
|--------|
| [@EL3NG](https://x.com/EL3NG) |
| [@0xZucho](https://x.com/0xZucho) |


---

## License

MIT
