use anchor_lang::prelude::*;

use crate::constants::PRODUCT_STATUS_PAUSED;
use crate::events::ProductPaused;
use crate::state::ProductState;

#[derive(Accounts)]
pub struct PauseProduct<'info> {
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller)]
    pub product_state: Account<'info, ProductState>
}

pub fn handler(ctx: Context<PauseProduct>) -> Result<()> {
    let product_state = &mut ctx.accounts.product_state;
    product_state.status = PRODUCT_STATUS_PAUSED;
    product_state.updated_at = Clock::get()?.unix_timestamp;

    emit!(ProductPaused {
        product: product_state.key()
    });

    Ok(())
}
