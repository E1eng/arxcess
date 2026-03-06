use anchor_lang::prelude::*;

#[event]
pub struct ProductCreated {
    pub product: Pubkey,
    pub seller: Pubkey,
    pub product_id: [u8; 32],
    pub price_lamports: u64
}

#[event]
pub struct ProductKeyDeposited {
    pub product: Pubkey,
    pub vault_handle: [u8; 32],
    pub key_commitment: [u8; 32]
}

#[event]
pub struct ProductActivated {
    pub product: Pubkey
}

#[event]
pub struct ProductPaused {
    pub product: Pubkey
}

#[event]
pub struct PurchaseCreated {
    pub purchase: Pubkey,
    pub product: Pubkey,
    pub buyer: Pubkey,
    pub amount_paid_lamports: u64,
    pub protocol_fee_lamports: u64
}

#[event]
pub struct DeliveryFinalized {
    pub purchase: Pubkey,
    pub approval_flag: u8,
    pub sealed_key_len: u16
}
