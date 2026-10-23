pub mod commands;
pub(crate) mod custom;
mod download;
mod gguf;
mod hf;
mod import;
mod manager;
pub mod registry;
mod selection;
pub(crate) mod system;
mod verified;

#[cfg(test)]
mod download_tests;

pub use manager::{ModelManager, draft_ready, entry};
