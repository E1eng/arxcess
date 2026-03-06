use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("sDNRRyCwQptaRZHATCha4nSJCFCwpcDWH2NvJCCAwFk");

#[program]
pub mod arxcess {
    use super::*;

    pub fn create_product(
        ctx: Context<CreateProduct>,
        product_id: [u8; 32],
        metadata_uri: String,
        ciphertext_cid: String,
        ciphertext_hash: [u8; 32],
        price_lamports: u64,
        protocol_fee_bps: u16,
        file_size_bytes: u64,
        license_duration_seconds: i64,
        max_access_count: u32,
        revocable: bool
    ) -> Result<()> {
        create_product::handler(
            ctx,
            product_id,
            metadata_uri,
            ciphertext_cid,
            ciphertext_hash,
            price_lamports,
            protocol_fee_bps,
            file_size_bytes,
            license_duration_seconds,
            max_access_count,
            revocable
        )
    }

    pub fn deposit_product_key(ctx: Context<DepositProductKey>, vault_handle: [u8; 32], key_commitment: [u8; 32]) -> Result<()> {
        deposit_product_key::handler(ctx, vault_handle, key_commitment)
    }

    pub fn activate_product(ctx: Context<ActivateProduct>) -> Result<()> {
        activate_product::handler(ctx)
    }

    pub fn pause_product(ctx: Context<PauseProduct>) -> Result<()> {
        pause_product::handler(ctx)
    }

    pub fn purchase_product(
        ctx: Context<PurchaseProduct>,
        purchase_id: [u8; 32],
        buyer_delivery_pubkey: [u8; 32]
    ) -> Result<()> {
        purchase_product::handler(ctx, purchase_id, buyer_delivery_pubkey)
    }

    pub fn finalize_delivery(
        ctx: Context<FinalizeDelivery>,
        approval_flag: u8,
        sealed_key_box: Vec<u8>,
        delivery_commitment: [u8; 32]
    ) -> Result<()> {
        finalize_delivery::handler(ctx, approval_flag, sealed_key_box, delivery_commitment)
    }

    pub fn consume_access(ctx: Context<ConsumeAccess>) -> Result<()> {
        consume_access::handler(ctx)
    }

    pub fn revoke_purchase(ctx: Context<RevokePurchase>) -> Result<()> {
        revoke_purchase::handler(ctx)
    }
}
