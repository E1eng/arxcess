use anchor_lang::prelude::*;

#[error_code]
pub enum ArxcessError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid product status")]
    InvalidProductStatus,
    #[msg("Invalid purchase status")]
    InvalidPurchaseStatus,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Invalid protocol fee bps")]
    InvalidProtocolFeeBps,
    #[msg("String too long for fixed storage")]
    StringTooLong,
    #[msg("Missing Arcium vault handle")]
    MissingVaultHandle,
    #[msg("Invalid delivery payload")]
    InvalidDeliveryPayload,
    #[msg("Math overflow")]
    MathOverflow
}
