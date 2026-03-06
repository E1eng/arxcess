use sha2::{Digest, Sha256};

pub const SEALED_KEY_BOX_BYTES: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluateAndSealInput {
    pub product_id: [u8; 32],
    pub purchase_id: [u8; 32],
    pub buyer_pubkey: [u8; 32],
    pub buyer_delivery_pubkey: [u8; 32],
    pub payment_verified: u8,
    pub product_active: u8,
    pub purchase_not_revoked: u8,
    pub delivery_not_yet_finalized: u8,
    pub ciphertext_hash: [u8; 32],
    pub content_key: [u8; 32]
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluateAndSealOutput {
    pub approval_flag: u8,
    pub sealed_key_box: [u8; SEALED_KEY_BOX_BYTES],
    pub delivery_commitment: [u8; 32]
}

pub fn evaluate_and_seal(input: &EvaluateAndSealInput) -> EvaluateAndSealOutput {
    let valid_purchase = input.payment_verified
        & input.product_active
        & input.purchase_not_revoked
        & input.delivery_not_yet_finalized;

    let sealed_real_key = seal_fixed(&input.content_key, &input.buyer_delivery_pubkey, &input.ciphertext_hash);
    let sealed_zero_key = seal_fixed(&[0u8; 32], &input.buyer_delivery_pubkey, &input.ciphertext_hash);
    let sealed_key_box = select_box(valid_purchase, sealed_real_key, sealed_zero_key);
    let delivery_commitment = sha256_many(&[
        &input.product_id,
        &input.purchase_id,
        &input.buyer_pubkey,
        &input.buyer_delivery_pubkey,
        &[valid_purchase],
        &sealed_key_box
    ]);

    EvaluateAndSealOutput {
        approval_flag: valid_purchase,
        sealed_key_box,
        delivery_commitment
    }
}

fn seal_fixed(content_key: &[u8; 32], buyer_delivery_pubkey: &[u8; 32], ciphertext_hash: &[u8; 32]) -> [u8; SEALED_KEY_BOX_BYTES] {
    let mut output = [0u8; SEALED_KEY_BOX_BYTES];
    let digest = sha256_many(&[content_key, buyer_delivery_pubkey, ciphertext_hash]);
    for i in 0..SEALED_KEY_BOX_BYTES {
        output[i] = digest[i % digest.len()] ^ buyer_delivery_pubkey[i % buyer_delivery_pubkey.len()];
    }
    output
}

fn select_box(selector: u8, truthy: [u8; SEALED_KEY_BOX_BYTES], falsy: [u8; SEALED_KEY_BOX_BYTES]) -> [u8; SEALED_KEY_BOX_BYTES] {
    let mut output = [0u8; SEALED_KEY_BOX_BYTES];
    let mask = 0u8.wrapping_sub(selector & 1);
    for i in 0..SEALED_KEY_BOX_BYTES {
        output[i] = (truthy[i] & mask) | (falsy[i] & !mask);
    }
    output
}

fn sha256_many(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}
