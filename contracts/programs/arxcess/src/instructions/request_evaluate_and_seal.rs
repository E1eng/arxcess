use anchor_lang::prelude::*;
use arcium_anchor::{
    queue_computation,
    traits::{CallbackCompAccs, QueueCompAccs},
    HasSize,
    ArgBuilder,
    prelude::*,
};
use arcium_client::idl::arcium::{
    cpi::accounts::QueueComputation,
    types::{CallbackAccount, CallbackInstruction},
};
use sha2::{Digest, Sha256};
use std::convert::TryInto;

const PACKED_DELIVERY_CIPHERTEXT_COUNT: usize = 2;

use crate::{
    ArciumSignerAccount,
    constants::{PRODUCT_STATUS_ACTIVE, PURCHASE_STATUS_PENDING_SEAL},
    errors::ArxcessError,
    events::{ArciumDeliveryComputationRequested, ArciumDeliverySettled},
    state::{ProductState, PurchaseState},
    ID,
    ID_CONST,
};

#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RequestEvaluateAndSeal<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, address = purchase_state.product)]
    pub product_state: Box<Account<'info, ProductState>>,
    #[account(mut)]
    pub purchase_state: Box<Account<'info, PurchaseState>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = authority,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    /// CHECK: mempool_account is constrained to the canonical Arcium mempool PDA and only forwarded into the Arcium CPI.
    #[account(mut, address = derive_mempool_pda!(mxe_account, ArxcessError::ClusterNotSet))]
    pub mempool_account: UncheckedAccount<'info>,
    /// CHECK: executing_pool is constrained to the canonical Arcium executing-pool PDA and only forwarded into the Arcium CPI.
    #[account(mut, address = derive_execpool_pda!(mxe_account, ArxcessError::ClusterNotSet))]
    pub executing_pool: UncheckedAccount<'info>,
    /// CHECK: computation_account is constrained to the canonical Arcium computation PDA for this request and only forwarded into the Arcium CPI.
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ArxcessError::ClusterNotSet))]
    pub computation_account: UncheckedAccount<'info>,
    /// CHECK: comp_def_account is constrained to the canonical computation-definition PDA and only forwarded into the Arcium CPI.
    #[account(address = derive_comp_def_pda!(crate::COMP_DEF_OFFSET_EVALUATE_AND_SEAL))]
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: cluster_account is constrained to the canonical cluster PDA and only forwarded into the Arcium CPI.
    #[account(mut, address = derive_cluster_pda!(mxe_account, ArxcessError::ClusterNotSet))]
    pub cluster_account: UncheckedAccount<'info>,
    /// CHECK: pool_account is constrained to the fixed Arcium fee pool PDA and only forwarded into the Arcium CPI.
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: UncheckedAccount<'info>,
    /// CHECK: clock_account is constrained to the fixed Arcium clock PDA and only forwarded into the Arcium CPI.
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct EvaluateAndSealRawOutput;

impl HasSize for EvaluateAndSealRawOutput {
    const SIZE: usize = 1 + 32 + 16 + (32 * PACKED_DELIVERY_CIPHERTEXT_COUNT);
}

impl<'info> QueueCompAccs<'info> for RequestEvaluateAndSeal<'info> {
    fn comp_def_offset(&self) -> u32 {
        crate::COMP_DEF_OFFSET_EVALUATE_AND_SEAL
    }

    fn queue_comp_accs(&self) -> QueueComputation<'info> {
        QueueComputation {
            signer: self.authority.to_account_info(),
            sign_seed: self.sign_pda_account.to_account_info(),
            comp: self.computation_account.to_account_info(),
            mxe: self.mxe_account.to_account_info(),
            mempool: self.mempool_account.to_account_info(),
            executing_pool: self.executing_pool.to_account_info(),
            comp_def_acc: self.comp_def_account.to_account_info(),
            cluster: self.cluster_account.to_account_info(),
            pool_account: self.pool_account.to_account_info(),
            system_program: self.system_program.to_account_info(),
            clock: self.clock_account.to_account_info(),
        }
    }

    fn arcium_program(&self) -> AccountInfo<'info> {
        self.arcium_program.to_account_info()
    }

    fn mxe_program(&self) -> Pubkey {
        crate::ID
    }

    fn signer_pda_bump(&self) -> u8 {
        Pubkey::find_program_address(&[SIGN_PDA_SEED], &ID_CONST).1
    }
}

pub fn handler(ctx: Context<RequestEvaluateAndSeal>, computation_offset: u64, _seal_nonce: u128) -> Result<()> {
    let authority = ctx.accounts.authority.key();

    require!(authority == ctx.accounts.product_state.seller || authority == ctx.accounts.product_state.treasury, ArxcessError::Unauthorized);
    require!(ctx.accounts.product_state.status == PRODUCT_STATUS_ACTIVE, ArxcessError::InvalidProductStatus);
    require!(ctx.accounts.product_state.arcium_custody_ready, ArxcessError::MissingArciumCustody);
    require!(ctx.accounts.purchase_state.status == PURCHASE_STATUS_PENDING_SEAL, ArxcessError::InvalidPurchaseStatus);
    require!(
        ctx.accounts.purchase_state.arcium_evaluate_computation_offset == 0 || ctx.accounts.purchase_state.arcium_delivery_ready,
        ArxcessError::ArciumComputationInFlight
    );

    let args = ArgBuilder::new()
        .plaintext_u128(ctx.accounts.product_state.arcium_key_nonce)
        .account(
            ctx.accounts.product_state.key(),
            ProductState::ARCIUM_MXE_CIPHERTEXTS_OFFSET,
            ProductState::ARCIUM_MXE_CIPHERTEXTS_LEN,
        )
        .plaintext_bool(true)
        .plaintext_bool(true)
        .plaintext_bool(!ctx.accounts.purchase_state.is_revoked())
        .plaintext_bool(ctx.accounts.purchase_state.status == PURCHASE_STATUS_PENDING_SEAL)
        .x25519_pubkey(ctx.accounts.purchase_state.buyer_delivery_pubkey)
        .plaintext_u128(_seal_nonce)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![EvaluateAndSealCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: ctx.accounts.purchase_state.key(),
                is_writable: true,
            }],
        )?],
        1,
        0,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let purchase_state = &mut ctx.accounts.purchase_state;
    purchase_state.arcium_delivery_ready = false;
    purchase_state.arcium_evaluate_computation_offset = computation_offset;
    purchase_state.arcium_evaluate_requested_at = now;

    emit!(ArciumDeliveryComputationRequested {
        purchase: purchase_state.key(),
        computation_offset,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct EvaluateAndSealCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    /// CHECK: comp_def_account is constrained to the canonical computation-definition PDA for evaluate_and_seal and only included for callback validation.
    #[account(address = derive_comp_def_pda!(crate::COMP_DEF_OFFSET_EVALUATE_AND_SEAL))]
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: computation_account is the Arcium computation PDA referenced by the callback and is only read by Arcium signature verification.
    pub computation_account: UncheckedAccount<'info>,
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar is validated via the fixed sysvar address and only used for callback instruction safety checks.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub purchase_state: Box<Account<'info, PurchaseState>>,
}

impl CallbackCompAccs for EvaluateAndSealCallback<'_> {
    fn callback_ix(
        computation_offset: u64,
        mxe_account: &MXEAccount,
        extra_accs: &[CallbackAccount],
    ) -> Result<CallbackInstruction> {
        let mut accounts = Vec::with_capacity(extra_accs.len() + 6);
        accounts.push(CallbackAccount {
            pubkey: ARCIUM_PROG_ID,
            is_writable: false,
        });
        accounts.push(CallbackAccount {
            pubkey: derive_comp_def_pda!(crate::COMP_DEF_OFFSET_EVALUATE_AND_SEAL),
            is_writable: false,
        });
        accounts.push(CallbackAccount {
            pubkey: derive_mxe_pda!(),
            is_writable: false,
        });
        accounts.push(CallbackAccount {
            pubkey: derive_comp_pda!(computation_offset, mxe_account, ArxcessError::ClusterNotSet),
            is_writable: false,
        });
        accounts.push(CallbackAccount {
            pubkey: derive_cluster_pda!(mxe_account, ArxcessError::ClusterNotSet),
            is_writable: false,
        });
        accounts.push(CallbackAccount {
            pubkey: ::anchor_lang::solana_program::sysvar::instructions::ID,
            is_writable: false,
        });
        accounts.extend_from_slice(extra_accs);

        Ok(CallbackInstruction {
            program_id: crate::ID_CONST,
            discriminator: crate::instruction::EvaluateAndSealV3Callback::DISCRIMINATOR.to_vec(),
            accounts,
        })
    }
}

fn parse_shared_material(bytes: &[u8]) -> Result<(bool, [u8; 32], u128, [[u8; 32]; PACKED_DELIVERY_CIPHERTEXT_COUNT])> {
    require!(bytes.len() == EvaluateAndSealRawOutput::SIZE, ArxcessError::InvalidDeliveryPayload);

    let approved = match bytes[0] {
        0 => false,
        1 => true,
        _ => return Err(error!(ArxcessError::InvalidDeliveryPayload)),
    };

    let encryption_key: [u8; 32] = bytes[1..33].try_into().map_err(|_| error!(ArxcessError::InvalidDeliveryPayload))?;
    let nonce = u128::from_le_bytes(bytes[33..49].try_into().map_err(|_| error!(ArxcessError::InvalidDeliveryPayload))?);
    let mut ciphertexts = [[0u8; 32]; PACKED_DELIVERY_CIPHERTEXT_COUNT];

    for (index, ciphertext) in ciphertexts.iter_mut().enumerate() {
        let start = 49 + (index * 32);
        let end = start + 32;
        ciphertext.copy_from_slice(&bytes[start..end]);
    }

    Ok((approved, encryption_key, nonce, ciphertexts))
}

pub fn callback_handler(
    ctx: Context<EvaluateAndSealCallback>,
    output: SignedComputationOutputs<EvaluateAndSealRawOutput>,
) -> Result<()> {
    let raw = output.verify_output_raw(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)?;
    let (approved, encryption_key, nonce, ciphertexts) = parse_shared_material(&raw)?;
    let purchase_state = &mut ctx.accounts.purchase_state;
    let now = Clock::get()?.unix_timestamp;

    purchase_state.entitlement_flag = if approved { 1 } else { 0 };
    purchase_state.arcium_delivery_encryption_key = encryption_key;
    purchase_state.arcium_delivery_nonce = nonce;
    purchase_state.arcium_delivery_ciphertexts = ciphertexts;
    purchase_state.arcium_delivery_ready = true;
    purchase_state.status = crate::constants::PURCHASE_STATUS_DELIVERED;
    purchase_state.delivered_at = now;
    purchase_state.arcium_evaluate_requested_at = now;

    let mut hasher = Sha256::new();
    hasher.update(purchase_state.arcium_delivery_encryption_key);
    hasher.update(purchase_state.arcium_delivery_nonce.to_le_bytes());
    for ciphertext in purchase_state.arcium_delivery_ciphertexts.iter() {
        hasher.update(ciphertext);
    }
    purchase_state.delivery_commitment = hasher.finalize().into();

    emit!(ArciumDeliverySettled {
        purchase: purchase_state.key(),
        computation_offset: purchase_state.arcium_evaluate_computation_offset,
        approval_flag: purchase_state.entitlement_flag,
    });

    Ok(())
}
