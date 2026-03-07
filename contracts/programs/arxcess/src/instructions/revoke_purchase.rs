use anchor_lang::prelude::*;

use crate::events::PurchaseRevoked;
use crate::state::{ProductState, PurchaseState};

#[derive(Accounts)]
pub struct RevokePurchase<'info> {
    pub authority: Signer<'info>,
    #[account(address = purchase_state.product)]
    pub product_state: Box<Account<'info, ProductState>>,
    #[account(mut)]
    pub purchase_state: Box<Account<'info, PurchaseState>>
}

pub fn handler(ctx: Context<RevokePurchase>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.purchase_state.revoke(
        &ctx.accounts.authority.key(),
        &ctx.accounts.product_state,
        now
    )?;

    emit!(PurchaseRevoked {
        purchase: ctx.accounts.purchase_state.key(),
        authority: ctx.accounts.authority.key(),
        revoked_at: now
    });

    Ok(())
}
