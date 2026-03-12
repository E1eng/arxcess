use anchor_lang::prelude::*;

use crate::events::ArciumProductKeyMaterialStaged;
use crate::state::ProductState;

#[derive(Accounts)]
pub struct StageProductArciumMaterial<'info> {
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller)]
    pub product_state: Box<Account<'info, ProductState>>
}

pub fn handler(
    ctx: Context<StageProductArciumMaterial>,
    encrypted_key_nonce: u128,
    encrypted_key_ciphertexts: [[u8; 32]; ProductState::ARCIUM_MXE_CIPHERTEXT_COUNT],
    key_commitment: [u8; 32],
) -> Result<()> {
    let product_state = &mut ctx.accounts.product_state;
    product_state.arcium_key_nonce = encrypted_key_nonce;
    product_state.arcium_key_ciphertexts = encrypted_key_ciphertexts;
    product_state.key_commitment = key_commitment;

    product_state.arcium_custody_ready = false;
    product_state.updated_at = Clock::get()?.unix_timestamp;

    emit!(ArciumProductKeyMaterialStaged {
        product: product_state.key(),
    });

    Ok(())
}
