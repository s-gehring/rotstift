use std::sync::OnceLock;

use spellbook::Dictionary;

const AFF: &str = include_str!("../../node_modules/dictionary-de/index.aff");
const DIC: &str = include_str!("../../node_modules/dictionary-de/index.dic");

const MAX_WORDS: usize = 20_000;
const MAX_WORD_CHARS: usize = 64;

fn german() -> Option<&'static Dictionary> {
    static DICTIONARY: OnceLock<Option<Dictionary>> = OnceLock::new();
    DICTIONARY
        .get_or_init(|| Dictionary::new(AFF, DIC).ok())
        .as_ref()
}

pub fn unknown_words(words: &[String]) -> Result<Vec<String>, String> {
    let dictionary = german().ok_or("dictionary")?;
    Ok(words
        .iter()
        .take(MAX_WORDS)
        .filter(|word| word.chars().count() <= MAX_WORD_CHARS && !dictionary.check(word))
        .cloned()
        .collect())
}

#[tauri::command]
pub async fn privacy_unknown_words(words: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || unknown_words(&words))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unknown(words: &[&str]) -> Vec<String> {
        let words: Vec<String> = words.iter().map(|word| (*word).to_owned()).collect();
        unknown_words(&words).expect("dictionary loads")
    }

    #[test]
    fn knows_german_words_and_compounds() {
        assert!(unknown(&["Schwimmbad", "Fahrradhelm", "gestern", "Häuser", "Straße"]).is_empty());
    }

    #[test]
    fn reports_names_it_does_not_know() {
        assert_eq!(
            unknown(&["Klingenberg", "Haus", "Tesfay"]),
            vec!["Klingenberg", "Tesfay"]
        );
    }
}
