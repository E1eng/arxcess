use anchor_lang::prelude::*;

use crate::constants::{CIPHERTEXT_CID_BYTES, METADATA_URI_BYTES, PRODUCT_STATUS_DRAFT};
use crate::errors::ArxcessError;
use crate::utils::copy_str_to_fixed;

#[account]
pub struct ProductState {
    pub bump: u8,
    pub product_id: [u8; 32],
    pub seller: Pubkey,
    pub treasury: Pubkey,
    pub price_lamports: u64,
    pub protocol_fee_bps: u16,
    pub status: u8,
    pub metadata_uri: [u8; METADATA_URI_BYTES],
    pub ciphertext_cid: [u8; CIPHERTEXT_CID_BYTES],
    pub ciphertext_hash: [u8; 32],
    pub file_size_bytes: u64,
    pub arcium_vault_handle: [u8; 32],
    pub key_commitment: [u8; 32],
    pub license_duration_seconds: i64,
    pub max_access_count: u32,
    pub revocable: bool,
    pub total_sales: u64,
    pub created_at: i64,
    pub updated_at: i64
}

impl ProductState {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + 8 + 2 + 1 + METADATA_URI_BYTES + CIPHERTEXT_CID_BYTES + 32 + 8 + 32 + 32 + 8 + 4 + 1 + 8 + 8 + 8;

    pub fn initialize(
        &mut self,
        bump: u8,
        seller: Pubkey,
        treasury: Pubkey,
        product_id: [u8; 32],
        metadata_uri: &str,
        ciphertext_cid: &str,
        ciphertext_hash: [u8; 32],
        price_lamports: u64,
        protocol_fee_bps: u16,
        file_size_bytes: u64,
        license_duration_seconds: i64,
        max_access_count: u32,
        revocable: bool,
        now: i64
    ) -> Result<()> {
        require!(license_duration_seconds >= 0, ArxcessError::InvalidAccessPolicy);
        require!(max_access_count > 0, ArxcessError::InvalidAccessPolicy);

        self.bump = bump;
        self.product_id = product_id;
        self.seller = seller;
        self.treasury = treasury;
        self.price_lamports = price_lamports;
        self.protocol_fee_bps = protocol_fee_bps;
        self.status = PRODUCT_STATUS_DRAFT;
        self.metadata_uri = copy_str_to_fixed(metadata_uri)?;
        self.ciphertext_cid = copy_str_to_fixed(ciphertext_cid)?;
        self.ciphertext_hash = ciphertext_hash;
        self.file_size_bytes = file_size_bytes;
        self.arcium_vault_handle = [0u8; 32];
        self.key_commitment = [0u8; 32];
        self.license_duration_seconds = license_duration_seconds;
        self.max_access_count = max_access_count;
        self.revocable = revocable;
        self.total_sales = 0;
        self.created_at = now;
        self.updated_at = now;
        Ok(())
    }
}
