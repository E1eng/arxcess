use anchor_lang::prelude::*;

use crate::events::AccessConsumed;
use crate::state::{ProductState, PurchaseState};

#[derive(Accounts)]
pub struct ConsumeAccess<'info> {
    pub buyer: Signer<'info>,
    #[account(address = purchase_state.product)]
    pub product_state: Account<'info, ProductState>,
    #[account(mut)]
    pub purchase_state: Account<'info, PurchaseState>
}

pub fn handler(ctx: Context<ConsumeAccess>) -> Result<()> {
    let purchase_state = &mut ctx.accounts.purchase_state;

    purchase_state.consume_access(&ctx.accounts.buyer.key())?;

    emit!(AccessConsumed {
        purchase: purchase_state.key(),
        buyer: ctx.accounts.buyer.key(),
        access_count: purchase_state.access_count
    });

    Ok(())
}
