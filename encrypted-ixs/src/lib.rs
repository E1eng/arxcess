 use arcis::*;

pub mod deposit_key;
pub mod evaluate_and_seal;

pub use deposit_key::*;
pub use evaluate_and_seal::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub type DeliveryMaterial = Pack<[u8; 44]>;

    #[instruction]
    pub fn deposit_key_v3(input_ctxt: Enc<Shared, DeliveryMaterial>) -> Enc<Mxe, DeliveryMaterial> {
        let input = input_ctxt.to_arcis();
        Mxe::get().from_arcis(input)
    }

    #[instruction]
    pub fn evaluate_and_seal_v2(
        input_ctxt: Enc<Mxe, DeliveryMaterial>,
        payment_verified: bool,
        product_active: bool,
        purchase_not_revoked: bool,
        delivery_not_yet_finalized: bool,
        buyer: Shared,
    ) -> (bool, Enc<Shared, DeliveryMaterial>) {
        let input = input_ctxt.to_arcis();
        let approved = payment_verified && product_active && purchase_not_revoked && delivery_not_yet_finalized;
        let selected = if approved {
            input
        } else {
            Pack::new([0u8; 44])
        };

        (approved.reveal(), buyer.from_arcis(selected))
    }

    #[instruction]
    pub fn evaluate_and_seal_v3(
        input_ctxt: Enc<Mxe, DeliveryMaterial>,
        payment_verified: bool,
        product_active: bool,
        purchase_not_revoked: bool,
        delivery_not_yet_finalized: bool,
        buyer: Shared,
    ) -> (bool, Enc<Shared, DeliveryMaterial>) {
        let input = input_ctxt.to_arcis();
        let approved = payment_verified && product_active && purchase_not_revoked && delivery_not_yet_finalized;
        let selected = if approved {
            input
        } else {
            Pack::new([0u8; 44])
        };

        (approved.reveal(), buyer.from_arcis(selected))
    }
}
