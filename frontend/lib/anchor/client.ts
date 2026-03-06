import { PublicKey } from "@solana/web3.js";

export function getProgramId(): PublicKey | null {
  const programId = process.env.NEXT_PUBLIC_PROGRAM_ID;
  if (!programId) {
    return null;
  }

  try {
    return new PublicKey(programId);
  } catch {
    return null;
  }
}

export function hasConfiguredProgramId() {
  return getProgramId() !== null;
}

export function getTreasuryPublicKey(): PublicKey | null {
  const treasury = process.env.NEXT_PUBLIC_TREASURY_WALLET;
  if (!treasury) {
    return null;
  }

  try {
    return new PublicKey(treasury);
  } catch {
    return null;
  }
}

export function hasConfiguredTreasuryPublicKey() {
  return getTreasuryPublicKey() !== null;
}
