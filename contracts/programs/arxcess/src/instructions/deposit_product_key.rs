use anchor_lang::prelude::*;

use crate::events::ProductKeyDeposited;
use crate::state::ProductState;

#[derive(Accounts)]
pub struct DepositProductKey<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller)]
    pub product_state: Box<Account<'info, ProductState>>
}

pub fn handler(ctx: Context<DepositProductKey>, vault_handle: [u8; 32], key_commitment: [u8; 32]) -> Result<()> {
    let product_state = &mut ctx.accounts.product_state;
    product_state.arcium_vault_handle = vault_handle;
    product_state.key_commitment = key_commitment;
    product_state.updated_at = Clock::get()?.unix_timestamp;

    emit!(ProductKeyDeposited {
        product: product_state.key(),
        vault_handle,
        key_commitment
    });

    Ok(())
}
