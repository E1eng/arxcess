use anchor_lang::prelude::*;

use crate::constants::{CIPHERTEXT_CID_BYTES, DELIVERY_PUBKEY_BYTES, PURCHASE_STATUS_DELIVERED, PURCHASE_STATUS_PENDING_SEAL, PURCHASE_STATUS_REVOKED, SEALED_KEY_BOX_BYTES};
use crate::errors::ArxcessError;
use crate::state::ProductState;
use crate::utils::copy_bytes_to_fixed;

const PURCHASE_BASE_STATE_BYTES: usize = 1 + 32 + 32 + 32 + DELIVERY_PUBKEY_BYTES + 8 + 8 + 8 + 1 + 1 + 2 + SEALED_KEY_BOX_BYTES + CIPHERTEXT_CID_BYTES + 32 + 8 + 4 + 4 + 8 + 8 + 8;
const ARCIUM_DELIVERY_CIPHERTEXT_COUNT: usize = 2;

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
    pub expires_at: i64,
    pub access_count: u32,
    pub max_access_count: u32,
    pub revoked_at: i64,
    pub created_at: i64,
    pub delivered_at: i64,
    pub arcium_delivery_ready: bool,
    pub arcium_evaluate_computation_offset: u64,
    pub arcium_evaluate_requested_at: i64,
    pub arcium_delivery_encryption_key: [u8; 32],
    pub arcium_delivery_nonce: u128,
    pub arcium_delivery_ciphertexts: [[u8; 32]; ARCIUM_DELIVERY_CIPHERTEXT_COUNT]
}

impl PurchaseState {
    pub const SPACE: usize = 8 + PURCHASE_BASE_STATE_BYTES + 1 + 8 + 8 + 32 + 16 + (32 * ARCIUM_DELIVERY_CIPHERTEXT_COUNT);

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
        expires_at: i64,
        max_access_count: u32,
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
        self.expires_at = expires_at;
        self.access_count = 0;
        self.max_access_count = max_access_count;
        self.revoked_at = 0;
        self.created_at = now;
        self.delivered_at = 0;
        self.arcium_delivery_ready = false;
        self.arcium_evaluate_computation_offset = 0;
        self.arcium_evaluate_requested_at = 0;
        self.arcium_delivery_encryption_key = [0u8; 32];
        self.arcium_delivery_nonce = 0;
        self.arcium_delivery_ciphertexts = [[0u8; 32]; ARCIUM_DELIVERY_CIPHERTEXT_COUNT];
        Ok(())
    }

    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at != 0 && now > self.expires_at
    }

    pub fn is_revoked(&self) -> bool {
        self.revoked_at != 0 || self.status == PURCHASE_STATUS_REVOKED
    }

    pub fn consume_access(&mut self, buyer: &Pubkey) -> Result<()> {
        require_keys_eq!(*buyer, self.buyer, ArxcessError::Unauthorized);
        require!(self.status == PURCHASE_STATUS_DELIVERED, ArxcessError::InvalidPurchaseStatus);
        require!(self.entitlement_flag == 1, ArxcessError::DeliveryNotApproved);
        require!(!self.is_revoked(), ArxcessError::AccessRevoked);

        let now = Clock::get()?.unix_timestamp;
        require!(!self.is_expired(now), ArxcessError::AccessExpired);
        require!(self.access_count < self.max_access_count, ArxcessError::AccessExhausted);

        self.access_count = self.access_count.checked_add(1).ok_or_else(|| error!(ArxcessError::MathOverflow))?;
        Ok(())
    }

    pub fn revoke(&mut self, authority: &Pubkey, product_state: &ProductState, now: i64) -> Result<()> {
        require!(product_state.revocable, ArxcessError::ProductNotRevocable);
        require!(*authority == product_state.seller || *authority == product_state.treasury, ArxcessError::Unauthorized);

        self.revoked_at = now;
        self.status = PURCHASE_STATUS_REVOKED;
        Ok(())
    }
}
