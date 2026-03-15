import { LocalProductListing } from "@/lib/storage/marketplace";

const LISTINGS_TABLE = "listings";
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

  return `${config.url}/rest/v1/${LISTINGS_TABLE}${query}`;
}

function mapRecordToListing(record: Record<string, unknown>): LocalProductListing {
  return {
    productIdHex: String(record.product_id_hex),
    title: String(record.title),
    description: String(record.description),
    category: String(record.category),
    priceSol: String(record.price_lamports ? Number(record.price_lamports) / 1e9 : 0),
    metadataCid: String(record.metadata_cid),
    metadataGatewayUrl: String(record.metadata_gateway_url),
    ciphertextCid: String(record.ciphertext_cid),
    ciphertextGatewayUrl: String(record.ciphertext_gateway_url),
    ciphertextHashHex: String(record.ciphertext_hash),
    mimeType: String(record.mime_type),
    fileSizeBytes: Number(record.file_size_bytes),
    sellerWallet: record.seller_wallet ? String(record.seller_wallet) : null,
    policy: {
      licenseDurationSeconds: Number(record.license_duration_seconds ?? 0),
      maxAccessCount: Number(record.max_access_count ?? 1),
      revocable: Boolean(record.revocable)
    },
    custodyMode: "arcium",
    keyCommitmentHex: record.key_commitment_hex ? String(record.key_commitment_hex) : undefined,
    createdAt: String(record.created_at),
    publishSignature: record.publish_signature ? String(record.publish_signature) : undefined,
    activationSignature: record.activation_signature ? String(record.activation_signature) : undefined
  };
}

function mapListingToRecord(listing: LocalProductListing) {
  return {
    id: listing.productIdHex, // Use productIdHex as id for uniqueness
    product_id_hex: listing.productIdHex,
    seller_wallet: listing.sellerWallet,
    metadata_uri: listing.metadataGatewayUrl, // Add missing metadata_uri
    ciphertext_cid: listing.ciphertextCid,
    ciphertext_hash: listing.ciphertextHashHex, // Fix field name
    price_lamports: Math.floor(Number(listing.priceSol) * 1e9),
    protocol_fee_bps: 250, // Add missing protocol_fee_bps
    file_size_bytes: listing.fileSizeBytes,
    license_duration_seconds: listing.policy.licenseDurationSeconds,
    max_access_count: listing.policy.maxAccessCount,
    revocable: listing.policy.revocable,
    custody_mode: "arcium",
    status: "draft",
    title: listing.title,
    description: listing.description,
    category: listing.category,
    metadata_cid: listing.metadataCid,
    metadata_gateway_url: listing.metadataGatewayUrl,
    ciphertext_gateway_url: listing.ciphertextGatewayUrl,
    ciphertext_hash_hex: listing.ciphertextHashHex,
    mime_type: listing.mimeType,
    policy: JSON.stringify(listing.policy),
    key_commitment_hex: listing.keyCommitmentHex ?? "",
    publish_signature: listing.publishSignature ?? "",
    price_sol: listing.priceSol, // Add price_sol field
    created_at: listing.createdAt
  };
}

export function hasSupabaseListingConfig() {
  return getSupabaseConfig() !== null;
}

export function isMissingSupabaseListingsTableError(message: string) {
  return message.includes(MISSING_TABLE_ERROR_CODE);
}

export async function listSupabaseListings(): Promise<LocalProductListing[]> {
  const response = await fetch(getRestUrl("?select=*&order=created_at.desc"), {
    method: "GET",
    headers: buildHeaders(),
    cache: "no-store"
  });

  if (!response.ok) {
    const message = await response.text();

    if (isMissingSupabaseListingsTableError(message)) {
      throw new Error("Supabase listings table is missing.");
    }

    throw new Error(message);
  }

  const payload = (await response.json()) as Record<string, unknown>[];
  return payload.map(mapRecordToListing);
}

export async function upsertSupabaseListing(listing: LocalProductListing): Promise<LocalProductListing> {
  const response = await fetch(getRestUrl("?on_conflict=id&select=*"), {
    method: "POST",
    headers: {
      ...buildHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(mapListingToRecord(listing))
  });

  if (!response.ok) {
    const message = await response.text();

    if (isMissingSupabaseListingsTableError(message)) {
      throw new Error("Supabase active listings table is missing.");
    }

    throw new Error(message);
  }

  const payload = (await response.json()) as Record<string, unknown>[];
  const stored = payload[0];

  if (!stored) {
    throw new Error("Supabase did not return the stored listing");
  }

  return mapRecordToListing(stored);
}
