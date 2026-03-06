use anchor_lang::prelude::*;

use crate::errors::ArxcessError;

pub fn copy_bytes_to_fixed<const N: usize>(input: &[u8]) -> Result<[u8; N]> {
    require!(input.len() <= N, ArxcessError::StringTooLong);
    let mut output = [0u8; N];
    output[..input.len()].copy_from_slice(input);
    Ok(output)
}

pub fn copy_str_to_fixed<const N: usize>(input: &str) -> Result<[u8; N]> {
    copy_bytes_to_fixed(input.as_bytes())
}

pub fn is_zero_bytes(input: &[u8]) -> bool {
    input.iter().all(|byte| *byte == 0)
}
