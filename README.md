# Arxcess

Arxcess is a monorepo for a web-first encrypted digital goods marketplace prototype built around Solana, Anchor, and a browser-based encryption flow.

The current prototype focuses on a simple public product structure:

- `Home` explains the product and directs people to the right workflow.
- `Explore` lists encrypted products that can be purchased from a connected wallet.
- `Launch` lets creators publish locked products from the browser.
- `Library` holds purchased items and exposes role-aware delivery actions.

At a system level, the prototype currently demonstrates these core journeys:

- Creators encrypt files in the browser before upload.
- Encrypted assets and metadata are stored through Pinata/IPFS.
- Purchasers buy on Solana and receive decryption access only after delivery is finalized.

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

- Next.js 14
- React 18
- TypeScript
- Solana wallet adapter
- Anchor
- Rust workspace for contracts and supporting crates
- Pinata/IPFS for encrypted asset storage

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
- encrypts the chosen file in the browser
- uploads ciphertext to Pinata/IPFS
- uploads metadata JSON
- asks the wallet to sign a Devnet publish transaction that creates, deposits, and activates the product on-chain
- stores the resulting listing locally and optionally in Supabase
- shows only essential listing terms such as price, access window, reveal limit, and revocable status

### Explore

The explore page reads stored listings and presents a minimal storefront. Buying sends the on-chain `purchase_product` transaction from the connected wallet.

- auto-generates or reuses the purchaser delivery key in-browser
- stores purchase intents locally after checkout succeeds
- highlights only essential public listing details such as publisher, price, access window, reveal limit, and revocable status

### Library

The library page is the reveal hub backed by local browser state plus on-chain purchase status. After checkout succeeds, entries move into `pending_seal` until delivery is finalized.

- shows purchased items with delivery status
- shows `Finalize delivery` only to the wallet that published the listing
- shows `Reveal & download` only to the wallet that created the purchase
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

## Development notes

- The frontend is the fastest place to iterate on UX and flow validation.
- The app currently relies on browser-local state for listings, purchases, and delivery keys, with optional shared listing sync through Supabase.
- The purchaser delivery key is auto-generated in-browser when needed, so checkout does not require a separate manual setup step.
- On-chain enforcement and Arcium-oriented delivery are represented as prototype-ready payload preparation, not a fully deployed production flow yet.

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
