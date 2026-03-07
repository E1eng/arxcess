use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::{DELIVERY_PUBKEY_BYTES, PRODUCT_STATUS_ACTIVE};
use crate::errors::ArxcessError;
use crate::events::PurchaseCreated;
use crate::state::{ProductState, PurchaseState};

#[derive(Accounts)]
#[instruction(purchase_id: [u8; 32])]
pub struct PurchaseProduct<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub seller: SystemAccount<'info>,
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    #[account(mut)]
    pub product_state: Box<Account<'info, ProductState>>,
    #[account(
        init,
        payer = buyer,
        seeds = [b"purchase", product_state.key().as_ref(), purchase_id.as_ref()],
        bump,
        space = PurchaseState::SPACE
    )]
    pub purchase_state: Box<Account<'info, PurchaseState>>,
    pub system_program: Program<'info, System>
}

pub fn handler(ctx: Context<PurchaseProduct>, purchase_id: [u8; 32], buyer_delivery_pubkey: [u8; DELIVERY_PUBKEY_BYTES]) -> Result<()> {
    let product_state = &mut ctx.accounts.product_state;

    require!(product_state.status == PRODUCT_STATUS_ACTIVE, ArxcessError::InvalidProductStatus);
    require_keys_eq!(ctx.accounts.seller.key(), product_state.seller, ArxcessError::Unauthorized);
    require_keys_eq!(ctx.accounts.treasury.key(), product_state.treasury, ArxcessError::Unauthorized);

    let amount_paid_lamports = product_state.price_lamports;
    let protocol_fee_lamports = ((amount_paid_lamports as u128) * (product_state.protocol_fee_bps as u128) / 10_000u128)
        .try_into()
        .map_err(|_| error!(ArxcessError::MathOverflow))?;
    let seller_proceeds_lamports = amount_paid_lamports
        .checked_sub(protocol_fee_lamports)
        .ok_or_else(|| error!(ArxcessError::MathOverflow))?;

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.seller.to_account_info()
            }
        ),
        seller_proceeds_lamports
    )?;

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.treasury.to_account_info()
            }
        ),
        protocol_fee_lamports
    )?;

    let now = Clock::get()?.unix_timestamp;
    let expires_at = if product_state.license_duration_seconds == 0 {
        0
    } else {
        now.checked_add(product_state.license_duration_seconds)
            .ok_or_else(|| error!(ArxcessError::MathOverflow))?
    };

    ctx.accounts.purchase_state.initialize(
        ctx.bumps.purchase_state,
        purchase_id,
        product_state.key(),
        ctx.accounts.buyer.key(),
        buyer_delivery_pubkey,
        amount_paid_lamports,
        protocol_fee_lamports,
        seller_proceeds_lamports,
        &product_state.ciphertext_cid,
        expires_at,
        product_state.max_access_count,
        now
    )?;

    product_state.total_sales = product_state.total_sales.checked_add(1).ok_or_else(|| error!(ArxcessError::MathOverflow))?;
    product_state.updated_at = now;

    emit!(PurchaseCreated {
        purchase: ctx.accounts.purchase_state.key(),
        product: product_state.key(),
        buyer: ctx.accounts.buyer.key(),
        amount_paid_lamports,
        protocol_fee_lamports
    });

    Ok(())
}
