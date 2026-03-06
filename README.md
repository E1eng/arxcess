# Arxcess

Arxcess is a monorepo for a web-first encrypted digital goods marketplace prototype built around Solana, Anchor, and a browser-based encryption flow.

The current prototype focuses on three core user journeys:

- Sellers encrypt files in the browser before upload.
- Encrypted assets and metadata are stored through Pinata/IPFS.
- Buyers prepare delivery keys and purchase payloads for later on-chain settlement and secure key delivery.

## Repository structure

```text
.
├── frontend/           # Next.js app for seller, catalog, and purchases flows
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
NEXT_PUBLIC_PROGRAM_ID=
PINATA_JWT=
```

For local frontend development, create:

```text
frontend/.env.local
```

Recommended local setup:

```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=your_program_id
PINATA_JWT=your_pinata_jwt
```

### Notes

- `NEXT_PUBLIC_SOLANA_RPC_URL` sets the client RPC endpoint.
- `NEXT_PUBLIC_PROGRAM_ID` is required for program-aware flows.
- `PINATA_JWT` is required for upload flows that send encrypted files and metadata to Pinata.

Do not commit local env files.

## Frontend flow

### Home

The landing page explains the encrypted marketplace model and links to the main prototype flows.

### Seller

The seller workbench:

- collects listing metadata
- encrypts the chosen file in the browser
- uploads ciphertext to Pinata/IPFS
- uploads metadata JSON
- stores the resulting listing locally in browser storage

### Products

The catalog page:

- reads locally stored listings
- shows metadata and ciphertext links
- prepares buyer purchase payloads
- stores prepared purchase intents locally

### Purchases

The purchases page:

- creates a buyer delivery keypair in browser storage
- lists prepared purchase intents
- shows the next payloads for future on-chain integration

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
- The app currently relies on browser-local state for listings, purchases, and delivery keys.
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
4. Create a seller listing
5. Review it in the product catalog
6. Prepare a purchase payload
7. Inspect delivery keys and prepared purchases

## License

MIT
