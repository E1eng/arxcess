use anchor_lang::prelude::*;
use arcium_anchor::{
    queue_computation,
    traits::{CallbackCompAccs, QueueCompAccs},
    ArgBuilder,
    HasSize,
    prelude::*,
};
use arcium_client::idl::arcium::{
    cpi::accounts::QueueComputation,
    types::{CallbackAccount, CallbackInstruction},
};
use std::convert::TryInto;

use crate::{
    ArciumSignerAccount,
    constants::{PRODUCT_STATUS_DRAFT, PRODUCT_STATUS_PAUSED},
    errors::ArxcessError,
    events::{ArciumProductKeyComputationRequested, ArciumProductKeySettled},
    state::ProductState,
    ID,
    ID_CONST,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DepositKeyRawOutput;

impl HasSize for DepositKeyRawOutput {
    const SIZE: usize = ProductState::ARCIUM_MXE_MATERIAL_LEN as usize;
}

#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RequestDepositProductKey<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, has_one = seller)]
    pub product_state: Box<Account<'info, ProductState>>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = seller,
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
    #[account(address = derive_comp_def_pda!(crate::COMP_DEF_OFFSET_DEPOSIT_KEY))]
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

impl<'info> QueueCompAccs<'info> for RequestDepositProductKey<'info> {
    fn comp_def_offset(&self) -> u32 {
        crate::COMP_DEF_OFFSET_DEPOSIT_KEY
    }

    fn queue_comp_accs(&self) -> QueueComputation<'info> {
        QueueComputation {
            signer: self.seller.to_account_info(),
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

pub fn handler(
    ctx: Context<RequestDepositProductKey>,
    computation_offset: u64,
    seller_encryption_key: [u8; 32],
    seller_nonce: u128,
    seller_ciphertexts: [[u8; 32]; ProductState::ARCIUM_MXE_CIPHERTEXT_COUNT],
    key_commitment: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.product_state.status == PRODUCT_STATUS_DRAFT || ctx.accounts.product_state.status == PRODUCT_STATUS_PAUSED,
        ArxcessError::InvalidProductStatus
    );
    require!(
        ctx.accounts.product_state.arcium_deposit_computation_offset == 0 || ctx.accounts.product_state.arcium_custody_ready,
        ArxcessError::ArciumComputationInFlight
    );

    let args = ArgBuilder::new()
        .x25519_pubkey(seller_encryption_key)
        .plaintext_u128(seller_nonce)
        .encrypted_u8(seller_ciphertexts[0])
        .encrypted_u8(seller_ciphertexts[1])
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        vec![DepositKeyCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: ctx.accounts.product_state.key(),
                is_writable: true,
            }],
        )?],
        1,
        0,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let product_state = &mut ctx.accounts.product_state;
    product_state.key_commitment = key_commitment;
    product_state.arcium_custody_ready = false;
    product_state.arcium_deposit_computation_offset = computation_offset;
    product_state.arcium_deposit_requested_at = now;
    product_state.updated_at = now;

    emit!(ArciumProductKeyComputationRequested {
        product: product_state.key(),
        computation_offset,
    });

    Ok(())
}

fn parse_mxe_material(bytes: &[u8]) -> Result<(u128, [[u8; 32]; ProductState::ARCIUM_MXE_CIPHERTEXT_COUNT])> {
    require!(bytes.len() == ProductState::ARCIUM_MXE_MATERIAL_LEN as usize, ArxcessError::InvalidDeliveryPayload);

    let nonce = u128::from_le_bytes(bytes[..16].try_into().map_err(|_| error!(ArxcessError::InvalidDeliveryPayload))?);
    let mut ciphertexts = [[0u8; 32]; ProductState::ARCIUM_MXE_CIPHERTEXT_COUNT];

    for (index, ciphertext) in ciphertexts.iter_mut().enumerate() {
        let start = 16 + (index * 32);
        let end = start + 32;
        ciphertext.copy_from_slice(&bytes[start..end]);
    }

    Ok((nonce, ciphertexts))
}

#[derive(Accounts)]
pub struct DepositKeyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    /// CHECK: comp_def_account is constrained to the canonical computation-definition PDA for deposit_key and only included for callback validation.
    #[account(address = derive_comp_def_pda!(crate::COMP_DEF_OFFSET_DEPOSIT_KEY))]
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
    pub product_state: Box<Account<'info, ProductState>>,
}

impl CallbackCompAccs for DepositKeyCallback<'_> {
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
            pubkey: derive_comp_def_pda!(crate::COMP_DEF_OFFSET_DEPOSIT_KEY),
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
            discriminator: crate::instruction::DepositKeyV3Callback::DISCRIMINATOR.to_vec(),
            accounts,
        })
    }
}

pub fn callback_handler(
    ctx: Context<DepositKeyCallback>,
    output: SignedComputationOutputs<DepositKeyRawOutput>,
) -> Result<()> {
    let raw = output.verify_output_raw(&ctx.accounts.cluster_account, &ctx.accounts.computation_account)?;
    let (nonce, ciphertexts) = parse_mxe_material(&raw)?;
    let product_state = &mut ctx.accounts.product_state;
    let now = Clock::get()?.unix_timestamp;

    product_state.arcium_key_nonce = nonce;
    product_state.arcium_key_ciphertexts = ciphertexts;
    product_state.arcium_custody_ready = true;
    product_state.arcium_deposit_requested_at = now;
    product_state.updated_at = now;

    emit!(ArciumProductKeySettled {
        product: product_state.key(),
        computation_offset: product_state.arcium_deposit_computation_offset,
    });

    Ok(())
}
