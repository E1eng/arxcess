Act as an Expert Solana and Arcium (MPC) Solutions Architect. We are pivoting our hackathon project, "Arxcess", to a Web-Only Decentralized Digital Asset Marketplace (like a Trustless Web3 Gumroad).

Here is the high-level concept:
1. Tech Stack: Next.js (Frontend), Solana Anchor (Smart Contracts), Arcium Arcis (MPC Circuits), Pinata/IPFS (Decrypted Storage).
2. The Goal: A marketplace where creators can sell digital assets (images, PDFs, code). The platform itself cannot see or steal the files because the encryption keys are managed by Arcium's decentralized MPC cluster.
3. Seller Flow: The creator uploads a file on the frontend. The frontend generates an AES key, encrypts the file, and uploads the ciphertext to IPFS. The frontend then sends the encrypted AES key to the Solana program, which uses a CPI to store it securely in Arcium's MPC vault (Enc<Mxe, T>).
4. Buyer Flow: A user pays for the asset via the Solana smart contract. Once payment is verified, Solana triggers Arcium. The MPC circuit evaluates the request, and if valid, re-encrypts (seals) the AES key specifically for the buyer's public key.
5. Delivery: The buyer's frontend receives the sealed key, decrypts it, fetches the IPFS ciphertext, and decrypts the file directly in the browser for viewing or downloading. No CLI or server-side execution is needed.
6. Business Model: The Solana smart contract takes a small protocol fee (e.g., 2.5%) from every successful sale.

Your Task:
Based on this high-level concept, please write a comprehensive `SYSTEM_DESIGN.md` document. It must include:
- High-Level Architecture & Separation of Concerns.
- Sequence Diagrams (using Mermaid syntax) for Seller Upload and Buyer Purchase/Decryption flows.
- Data Structures: Solana Anchor Accounts (ProductState, PurchaseState) and Arcis MPC Circuits (`deposit_key` and `evaluate_and_seal`).
- Project Folder Structure for a monorepo.
- Step-by-Step Implementation Roadmap.

CRITICAL: Remember Arcium's strict MPC constraints for the circuits (no early returns, use fixed-size arrays, evaluate both branches of conditions). 

Please output the complete Markdown content so I can save it as `SYSTEM_DESIGN.md`. Do not write the actual codebase yet.