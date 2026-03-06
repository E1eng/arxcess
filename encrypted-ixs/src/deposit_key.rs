use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DepositKeyInput {
    pub product_id: [u8; 32],
    pub seller_pubkey: [u8; 32],
    pub ciphertext_hash: [u8; 32],
    pub metadata_commitment: [u8; 32],
    pub content_key: [u8; 32]
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DepositKeyOutput {
    pub vault_handle: [u8; 32],
    pub key_commitment: [u8; 32],
    pub success_flag: u8
}

pub fn deposit_key(input: &DepositKeyInput) -> DepositKeyOutput {
    let vault_handle = sha256_many(&[
        &input.product_id,
        &input.seller_pubkey,
        &input.ciphertext_hash,
        &input.metadata_commitment
    ]);
    let key_commitment = sha256_many(&[
        &input.product_id,
        &input.seller_pubkey,
        &input.ciphertext_hash,
        &input.content_key
    ]);

    DepositKeyOutput {
        vault_handle,
        key_commitment,
        success_flag: 1
    }
}

fn sha256_many(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}
