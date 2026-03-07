use anchor_lang::prelude::*;

use crate::constants::{PRODUCT_STATUS_ACTIVE, PRODUCT_STATUS_DRAFT, PRODUCT_STATUS_PAUSED};
use crate::errors::ArxcessError;
use crate::events::ProductActivated;
use crate::state::ProductState;
use crate::utils::is_zero_bytes;

#[derive(Accounts)]
pub struct ActivateProduct<'info> {
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller)]
    pub product_state: Box<Account<'info, ProductState>>
}

pub fn handler(ctx: Context<ActivateProduct>) -> Result<()> {
    let product_state = &mut ctx.accounts.product_state;
    require!(
        product_state.status == PRODUCT_STATUS_DRAFT || product_state.status == PRODUCT_STATUS_PAUSED,
        ArxcessError::InvalidProductStatus
    );
    require!(product_state.arcium_custody_ready || !is_zero_bytes(&product_state.arcium_vault_handle), ArxcessError::MissingVaultHandle);

    product_state.status = PRODUCT_STATUS_ACTIVE;
    product_state.updated_at = Clock::get()?.unix_timestamp;

    emit!(ProductActivated {
        product: product_state.key()
    });

    Ok(())
}
