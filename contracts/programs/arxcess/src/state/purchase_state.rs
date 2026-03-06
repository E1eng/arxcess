use anchor_lang::prelude::*;

use crate::constants::{CIPHERTEXT_CID_BYTES, DELIVERY_PUBKEY_BYTES, PURCHASE_STATUS_PENDING_SEAL, SEALED_KEY_BOX_BYTES};
use crate::utils::copy_bytes_to_fixed;

#[account]
pub struct PurchaseState {
    pub bump: u8,
    pub purchase_id: [u8; 32],
    pub product: Pubkey,
    pub buyer: Pubkey,
    pub buyer_delivery_pubkey: [u8; DELIVERY_PUBKEY_BYTES],
    pub amount_paid_lamports: u64,
    pub protocol_fee_lamports: u64,
    pub seller_proceeds_lamports: u64,
    pub status: u8,
    pub entitlement_flag: u8,
    pub sealed_key_len: u16,
    pub sealed_key_box: [u8; SEALED_KEY_BOX_BYTES],
    pub ciphertext_cid_snapshot: [u8; CIPHERTEXT_CID_BYTES],
    pub delivery_commitment: [u8; 32],
    pub created_at: i64,
    pub delivered_at: i64
}

impl PurchaseState {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 32 + DELIVERY_PUBKEY_BYTES + 8 + 8 + 8 + 1 + 1 + 2 + SEALED_KEY_BOX_BYTES + CIPHERTEXT_CID_BYTES + 32 + 8 + 8;

    pub fn initialize(
        &mut self,
        bump: u8,
        purchase_id: [u8; 32],
        product: Pubkey,
        buyer: Pubkey,
        buyer_delivery_pubkey: [u8; DELIVERY_PUBKEY_BYTES],
        amount_paid_lamports: u64,
        protocol_fee_lamports: u64,
        seller_proceeds_lamports: u64,
        ciphertext_cid_snapshot: &[u8],
        now: i64
    ) -> Result<()> {
        self.bump = bump;
        self.purchase_id = purchase_id;
        self.product = product;
        self.buyer = buyer;
        self.buyer_delivery_pubkey = buyer_delivery_pubkey;
        self.amount_paid_lamports = amount_paid_lamports;
        self.protocol_fee_lamports = protocol_fee_lamports;
        self.seller_proceeds_lamports = seller_proceeds_lamports;
        self.status = PURCHASE_STATUS_PENDING_SEAL;
        self.entitlement_flag = 0;
        self.sealed_key_len = 0;
        self.sealed_key_box = [0u8; SEALED_KEY_BOX_BYTES];
        self.ciphertext_cid_snapshot = copy_bytes_to_fixed(ciphertext_cid_snapshot)?;
        self.delivery_commitment = [0u8; 32];
        self.created_at = now;
        self.delivered_at = 0;
        Ok(())
    }
}
