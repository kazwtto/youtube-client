pub mod model;
pub mod service;

pub use model::{TabMediaState, TabSessionSnapshot, TabState, DEFAULT_HISTORY_SCOPE};
pub use service::{CloseTabOutcome, TabManager};
