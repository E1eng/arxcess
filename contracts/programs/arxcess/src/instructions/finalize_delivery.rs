use anchor_lang::prelude::*;

use crate::constants::{PURCHASE_STATUS_DELIVERED, PURCHASE_STATUS_PENDING_SEAL, SEALED_KEY_BOX_BYTES};
use crate::errors::ArxcessError;
use crate::events::DeliveryFinalized;
use crate::state::{ProductState, PurchaseState};
use crate::utils::copy_bytes_to_fixed;

#[derive(Accounts)]
pub struct FinalizeDelivery<'info> {
    pub authority: Signer<'info>,
    #[account(address = purchase_state.product)]
    pub product_state: Account<'info, ProductState>,
    #[account(mut)]
    pub purchase_state: Account<'info, PurchaseState>,
}

pub fn handler(
    ctx: Context<FinalizeDelivery>,
    approval_flag: u8,
    sealed_key_box: Vec<u8>,
    delivery_commitment: [u8; 32]
) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    require!(
        authority == ctx.accounts.product_state.treasury || authority == ctx.accounts.product_state.seller,
        ArxcessError::Unauthorized
    );

    let purchase_state = &mut ctx.accounts.purchase_state;
    require!(purchase_state.status == PURCHASE_STATUS_PENDING_SEAL, ArxcessError::InvalidPurchaseStatus);
    require!(sealed_key_box.len() <= SEALED_KEY_BOX_BYTES, ArxcessError::InvalidDeliveryPayload);
    require!(!purchase_state.is_revoked(), ArxcessError::AccessRevoked);
    require!(!purchase_state.is_expired(Clock::get()?.unix_timestamp), ArxcessError::AccessExpired);

    purchase_state.entitlement_flag = approval_flag;
    purchase_state.sealed_key_len = sealed_key_box.len() as u16;
    purchase_state.sealed_key_box = copy_bytes_to_fixed::<SEALED_KEY_BOX_BYTES>(&sealed_key_box)?;
    purchase_state.delivery_commitment = delivery_commitment;
    purchase_state.status = PURCHASE_STATUS_DELIVERED;
    purchase_state.delivered_at = Clock::get()?.unix_timestamp;

    emit!(DeliveryFinalized {
        purchase: purchase_state.key(),
        approval_flag,
        sealed_key_len: purchase_state.sealed_key_len
    });

    Ok(())
}
