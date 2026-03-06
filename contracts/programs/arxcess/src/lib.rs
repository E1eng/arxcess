use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("Fg6PaFpoGXkYsidMpWxTWqkZK6W2BeZ7FEfcYkgmqPae");

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
        file_size_bytes: u64
    ) -> Result<()> {
        create_product::handler(
            ctx,
            product_id,
            metadata_uri,
            ciphertext_cid,
            ciphertext_hash,
            price_lamports,
            protocol_fee_bps,
            file_size_bytes
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
}
