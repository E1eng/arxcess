use anchor_lang::prelude::*;

use crate::errors::ArxcessError;
use crate::events::ProductCreated;
use crate::state::ProductState;

#[derive(Accounts)]
#[instruction(product_id: [u8; 32])]
pub struct CreateProduct<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    pub treasury: SystemAccount<'info>,
    #[account(
        init,
        payer = seller,
        seeds = [b"product", seller.key().as_ref(), product_id.as_ref()],
        bump,
        space = ProductState::SPACE
    )]
    pub product_state: Account<'info, ProductState>,
    pub system_program: Program<'info, System>
}

pub fn handler(
    ctx: Context<CreateProduct>,
    product_id: [u8; 32],
    metadata_uri: String,
    ciphertext_cid: String,
    ciphertext_hash: [u8; 32],
    price_lamports: u64,
    protocol_fee_bps: u16,
    file_size_bytes: u64
) -> Result<()> {
    require!(price_lamports > 0, ArxcessError::InvalidPrice);
    require!(protocol_fee_bps <= 10_000, ArxcessError::InvalidProtocolFeeBps);

    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.product_state.initialize(
        ctx.bumps.product_state,
        ctx.accounts.seller.key(),
        ctx.accounts.treasury.key(),
        product_id,
        &metadata_uri,
        &ciphertext_cid,
        ciphertext_hash,
        price_lamports,
        protocol_fee_bps,
        file_size_bytes,
        now
    )?;

    emit!(ProductCreated {
        product: ctx.accounts.product_state.key(),
        seller: ctx.accounts.seller.key(),
        product_id,
        price_lamports
    });

    Ok(())
}
