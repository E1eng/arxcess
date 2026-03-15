import { LocalPurchaseIntent } from "@/lib/storage/marketplace";

const PURCHASES_TABLE = "purchases";
const MISSING_TABLE_ERROR_CODE = "PGRST205";

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return {
    url,
    serviceRoleKey
  };
}

function buildHeaders() {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error("Missing Supabase configuration");
  }

  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json"
  };
}

function getRestUrl(query: string) {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error("Missing Supabase configuration");
  }

  return `${config.url}/rest/v1/${PURCHASES_TABLE}${query}`;
}

function mapRecordToPurchase(record: Record<string, unknown>): LocalPurchaseIntent {
  return {
    purchaseIdHex: String(record.purchase_id_hex),
    productIdHex: String(record.product_id_hex),
    buyerWallet: record.buyer_wallet ? String(record.buyer_wallet) : null,
    sellerWallet: record.seller_wallet ? String(record.seller_wallet) : null,
    buyerDeliveryPublicKeyBase64: String(record.buyer_delivery_pubkey ?? ""),
    amountSol: String(record.amount_paid_lamports ? Number(record.amount_paid_lamports) / 1e9 : 0),
    status: String(record.status ?? "prepared") as LocalPurchaseIntent["status"],
    accessCount: Number(record.access_count ?? 0),
    maxAccessCount: Number(record.max_access_count ?? 1),
    expiresAt: record.expires_at ? String(record.expires_at) : null,
    revokedAt: record.revoked_at ? String(record.revoked_at) : null,
    createdAt: String(record.created_at),
    transactionSignature: record.transaction_signature ? String(record.transaction_signature) : undefined,
    finalizeSignature: record.finalize_signature ? String(record.finalize_signature) : undefined,
    deliveryMode: record.delivery_mode ? "arcium" : undefined
  };
}

function mapPurchaseToRecord(purchase: LocalPurchaseIntent) {
  return {
    id: purchase.purchaseIdHex,
    purchase_id_hex: purchase.purchaseIdHex,
    product_id_hex: purchase.productIdHex,
    buyer_wallet: purchase.buyerWallet,
    seller_wallet: purchase.sellerWallet ?? null,
    amount_paid_lamports: Math.floor(Number(purchase.amountSol) * 1e9),
    protocol_fee_lamports: 0,
    buyer_delivery_pubkey: purchase.buyerDeliveryPublicKeyBase64,
    status: purchase.status,
    access_count: purchase.accessCount,
    max_access_count: purchase.maxAccessCount,
    expires_at: purchase.expiresAt ?? null,
    revoked_at: purchase.revokedAt ?? null,
    transaction_signature: purchase.transactionSignature ?? "",
    finalize_signature: purchase.finalizeSignature ?? "",
    delivery_mode: purchase.deliveryMode ?? "arcium",
    created_at: purchase.createdAt,
    updated_at: new Date().toISOString()
  };
}

export function hasSupabasePurchaseConfig() {
  return getSupabaseConfig() !== null;
}

export function isMissingSupabasePurchasesTableError(message: string) {
  return message.includes(MISSING_TABLE_ERROR_CODE);
}

export async function listSupabasePurchases(): Promise<LocalPurchaseIntent[]> {
  const response = await fetch(getRestUrl("?select=*&order=created_at.desc"), {
    method: "GET",
    headers: buildHeaders(),
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();

    if (isMissingSupabasePurchasesTableError(message)) {
      throw new Error("Supabase purchases table is missing.");
    }

    throw new Error(message);
  }

  const payload = (await response.json()) as Record<string, unknown>[];
  return payload.map(mapRecordToPurchase);
}

export async function upsertSupabasePurchase(purchase: LocalPurchaseIntent): Promise<LocalPurchaseIntent> {
  const response = await fetch(getRestUrl("?on_conflict=id&select=*"), {
    method: "POST",
    headers: {
      ...buildHeaders(),
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(mapPurchaseToRecord(purchase))
  });

  if (!response.ok) {
    const message = await response.text();

    if (isMissingSupabasePurchasesTableError(message)) {
      throw new Error("Supabase purchases table is missing.");
    }

    throw new Error(message);
  }

  const payload = (await response.json()) as Record<string, unknown>[];
  const stored = payload[0];

  if (!stored) {
    throw new Error("Supabase did not return the stored purchase");
  }

  return mapRecordToPurchase(stored);
}
