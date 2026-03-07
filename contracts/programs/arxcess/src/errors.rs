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
    MathOverflow,
    #[msg("Invalid access policy")]
    InvalidAccessPolicy,
    #[msg("Access entitlement has expired")]
    AccessExpired,
    #[msg("Access entitlement has been revoked")]
    AccessRevoked,
    #[msg("Access quota has been exhausted")]
    AccessExhausted,
    #[msg("This product is not revocable")]
    ProductNotRevocable,
    #[msg("Delivery approval was denied")]
    DeliveryNotApproved,
    #[msg("Arcium computation is already in flight")]
    ArciumComputationInFlight,
    #[msg("MXE cluster is not initialized for this program")]
    ClusterNotSet,
    #[msg("Arcium custody material is missing")]
    MissingArciumCustody
}
