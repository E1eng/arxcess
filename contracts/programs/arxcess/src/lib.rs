use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

pub use errors::ArxcessError as ErrorCode;
pub use instructions::*;
use state::ProductState;

pub const COMP_DEF_OFFSET_DEPOSIT_KEY: u32 = comp_def_offset("deposit_key_v3");
pub const COMP_DEF_OFFSET_EVALUATE_AND_SEAL: u32 = comp_def_offset("evaluate_and_seal_v3");

declare_id!("sDNRRyCwQptaRZHATCha4nSJCFCwpcDWH2NvJCCAwFk");

#[arcium_program]
pub mod arxcess {
    use super::*;

    pub fn init_deposit_key_comp_def(ctx: Context<InitDepositKeyCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_evaluate_and_seal_comp_def(ctx: Context<InitEvaluateAndSealCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn create_product(
        ctx: Context<CreateProduct>,
        product_id: [u8; 32],
        metadata_uri: String,
        ciphertext_cid: String,
        ciphertext_hash: [u8; 32],
        price_lamports: u64,
        protocol_fee_bps: u16,
        file_size_bytes: u64,
        license_duration_seconds: i64,
        max_access_count: u32,
        revocable: bool
    ) -> Result<()> {
        create_product::handler(
            ctx,
            product_id,
            metadata_uri,
            ciphertext_cid,
            ciphertext_hash,
            price_lamports,
            protocol_fee_bps,
            file_size_bytes,
            license_duration_seconds,
            max_access_count,
            revocable
        )
    }

    pub fn deposit_product_key(ctx: Context<DepositProductKey>, vault_handle: [u8; 32], key_commitment: [u8; 32]) -> Result<()> {
        deposit_product_key::handler(ctx, vault_handle, key_commitment)
    }

    pub fn stage_product_arcium_material(
        ctx: Context<StageProductArciumMaterial>,
        encrypted_key_nonce: u128,
        encrypted_key_ciphertexts: [[u8; 32]; ProductState::ARCIUM_MXE_CIPHERTEXT_COUNT],
        key_commitment: [u8; 32],
    ) -> Result<()> {
        stage_product_arcium_material::handler(ctx, encrypted_key_nonce, encrypted_key_ciphertexts, key_commitment)
    }

    pub fn request_deposit_product_key(
        ctx: Context<RequestDepositProductKey>,
        computation_offset: u64,
        seller_encryption_key: [u8; 32],
        seller_nonce: u128,
        seller_ciphertexts: [[u8; 32]; ProductState::ARCIUM_MXE_CIPHERTEXT_COUNT],
        key_commitment: [u8; 32],
    ) -> Result<()> {
        request_deposit_product_key::handler(ctx, computation_offset, seller_encryption_key, seller_nonce, seller_ciphertexts, key_commitment)
    }

    pub fn activate_product(ctx: Context<ActivateProduct>) -> Result<()> {
        activate_product::handler(ctx)
    }

    pub fn pause_product(ctx: Context<PauseProduct>) -> Result<()> {
        pause_product::handler(ctx)
    }

    pub fn purchase_product(
        ctx: Context<PurchaseProduct>,
        purchase_id: [u8; 32],
        buyer_delivery_pubkey: [u8; 32]
    ) -> Result<()> {
        purchase_product::handler(ctx, purchase_id, buyer_delivery_pubkey)
    }

    pub fn finalize_delivery(
        ctx: Context<FinalizeDelivery>,
        approval_flag: u8,
        sealed_key_box: Vec<u8>,
        delivery_commitment: [u8; 32]
    ) -> Result<()> {
        finalize_delivery::handler(ctx, approval_flag, sealed_key_box, delivery_commitment)
    }

    pub fn request_evaluate_and_seal(
        ctx: Context<RequestEvaluateAndSeal>,
        computation_offset: u64,
        seal_nonce: u128,
    ) -> Result<()> {
        request_evaluate_and_seal::handler(ctx, computation_offset, seal_nonce)
    }

    #[arcium_callback(encrypted_ix = "deposit_key_v3", auto_serialize = false)]
    pub fn deposit_key_v3_callback(
        ctx: Context<DepositKeyCallback>,
        output: SignedComputationOutputs<DepositKeyRawOutput>,
    ) -> Result<()> {
        request_deposit_product_key::callback_handler(ctx, output)
    }

    #[arcium_callback(encrypted_ix = "evaluate_and_seal_v3", auto_serialize = false)]
    pub fn evaluate_and_seal_v3_callback(
        ctx: Context<EvaluateAndSealCallback>,
        output: SignedComputationOutputs<EvaluateAndSealRawOutput>,
    ) -> Result<()> {
        request_evaluate_and_seal::callback_handler(ctx, output)
    }

    pub fn consume_access(ctx: Context<ConsumeAccess>) -> Result<()> {
        consume_access::handler(ctx)
    }

    pub fn revoke_purchase(ctx: Context<RevokePurchase>) -> Result<()> {
        revoke_purchase::handler(ctx)
    }
}

#[init_computation_definition_accounts("deposit_key_v3", payer)]
#[derive(Accounts)]
pub struct InitDepositKeyCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account is validated by the Arcium program during computation definition initialization.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table is validated by the Arcium program during computation definition initialization.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the address lookup table program checked via the fixed address constraint.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[init_computation_definition_accounts("evaluate_and_seal_v3", payer)]
#[derive(Accounts)]
pub struct InitEvaluateAndSealCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account is validated by the Arcium program during computation definition initialization.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table is validated by the Arcium program during computation definition initialization.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the address lookup table program checked via the fixed address constraint.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}
