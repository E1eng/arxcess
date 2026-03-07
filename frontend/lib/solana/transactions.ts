import { Connection } from "@solana/web3.js";

function formatTransactionError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "unknown transaction error";
  }
}

export async function confirmTransactionOrThrow(args: {
  blockhash: string;
  connection: Connection;
  label: string;
  lastValidBlockHeight: number;
  signature: string;
}) {
  const confirmation = await args.connection.confirmTransaction(
    {
      signature: args.signature,
      blockhash: args.blockhash,
      lastValidBlockHeight: args.lastValidBlockHeight
    },
    "confirmed"
  );

  if (!confirmation.value.err) {
    return confirmation;
  }

  let message = `${args.label} failed on-chain: ${formatTransactionError(confirmation.value.err)}`;

  try {
    const transaction = await args.connection.getTransaction(args.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    const logs = transaction?.meta?.logMessages?.slice(-8);

    if (logs && logs.length > 0) {
      message = `${message}. Logs: ${logs.join(" | ")}`;
    }
  } catch {}

  throw new Error(message);
}
