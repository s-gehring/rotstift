use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::download::DownloadError;
use super::manager;
use super::registry::{DEFAULT_CORRECTOR_ID, DEFAULT_MODEL_ID, ModelEntry, Role};
use crate::llm::runtime::RuntimeStatus;

const SELECTION_FILE: &str = "selection.json";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Selection {
    model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    corrector_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reviewer_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    Transcriber,
    Corrector,
    Reviewer,
}

impl Slot {
    const ALL: [Self; 3] = [Self::Transcriber, Self::Corrector, Self::Reviewer];

    fn role(self) -> Role {
        match self {
            Self::Transcriber => Role::Transcriber,
            Self::Corrector | Self::Reviewer => Role::Corrector,
        }
    }

    fn default_id(self) -> &'static str {
        match self {
            Self::Transcriber => DEFAULT_MODEL_ID,
            Self::Corrector | Self::Reviewer => DEFAULT_CORRECTOR_ID,
        }
    }

    fn field(self, selection: &mut Selection) -> &mut Option<String> {
        match self {
            Self::Transcriber => &mut selection.model_id,
            Self::Corrector => &mut selection.corrector_id,
            Self::Reviewer => &mut selection.reviewer_id,
        }
    }
}

pub fn selection_path(models_dir: &Path) -> PathBuf {
    models_dir
        .parent()
        .unwrap_or(models_dir)
        .join(SELECTION_FILE)
}

fn read(path: &Path) -> Option<Selection> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn load_slot(path: &Path, slot: Slot) -> Option<String> {
    let id = slot.field(&mut read(path)?).take()?;
    manager::entry(&id)
        .ok()
        .filter(|entry| entry.role == slot.role())
        .map(|entry| entry.id.clone())
}

pub fn load(path: &Path) -> Option<String> {
    load_slot(path, Slot::Transcriber)
}

fn write(path: &Path, selection: &Selection) -> Result<(), DownloadError> {
    let text =
        serde_json::to_string(selection).map_err(|error| DownloadError::Io(error.to_string()))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text)?;
    std::fs::rename(&temp, path)?;
    Ok(())
}

pub fn save_slot(path: &Path, slot: Slot, entry: &ModelEntry) -> Result<(), DownloadError> {
    if entry.role != slot.role() {
        return Err(DownloadError::UnknownModel(entry.id.clone()));
    }
    let mut selection = read(path).unwrap_or_default();
    *slot.field(&mut selection) = Some(entry.id.clone());
    write(path, &selection)
}

pub fn save(path: &Path, entry: &ModelEntry) -> Result<(), DownloadError> {
    save_slot(path, Slot::Transcriber, entry)
}

pub fn forget(path: &Path, deleted: &ModelEntry) -> Result<(), DownloadError> {
    for slot in Slot::ALL {
        if slot.role() == deleted.role
            && deleted.id != slot.default_id()
            && load_slot(path, slot).as_deref() == Some(deleted.id.as_str())
        {
            save_slot(path, slot, manager::entry(slot.default_id())?)?;
        }
    }
    Ok(())
}

pub fn serves_model(status: &RuntimeStatus, entry: &ModelEntry) -> bool {
    match status {
        RuntimeStatus::Starting { model } | RuntimeStatus::Ready { model, .. } => {
            *model == entry.files.model.name
        }
        RuntimeStatus::Stopped | RuntimeStatus::Failed { .. } => false,
    }
}

pub fn runs_other_model(status: &RuntimeStatus, entry: &ModelEntry) -> bool {
    match status {
        RuntimeStatus::Starting { .. } | RuntimeStatus::Ready { .. } => {
            !serves_model(status, entry)
        }
        RuntimeStatus::Stopped | RuntimeStatus::Failed { .. } => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::runtime::LlmError;
    use crate::models::registry::registry;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rotstift-selection-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn models() -> (&'static ModelEntry, &'static ModelEntry) {
        let registry = registry().unwrap();
        let first = &registry.models[0];
        let second = registry
            .models
            .iter()
            .find(|entry| entry.id != first.id)
            .unwrap();
        (first, second)
    }

    fn ready(entry: &ModelEntry) -> RuntimeStatus {
        RuntimeStatus::Ready {
            model: entry.files.model.name.clone(),
            port: 1234,
        }
    }

    #[test]
    fn nothing_is_selected_before_the_first_choice() {
        let dir = temp_dir("empty");
        assert_eq!(load(&selection_path(&dir.join("models"))), None);
    }

    #[test]
    fn a_choice_survives_a_restart_and_can_be_changed() {
        let dir = temp_dir("persist");
        let path = selection_path(&dir.join("models"));
        let (first, second) = models();
        save(&path, second).unwrap();
        assert_eq!(load(&path), Some(second.id.clone()));
        save(&path, first).unwrap();
        assert_eq!(load(&path), Some(first.id.clone()));
    }

    #[test]
    fn deleting_the_chosen_model_falls_back_to_the_default() {
        let dir = temp_dir("forget");
        let path = selection_path(&dir.join("models"));
        let (first, second) = models();
        assert_eq!(first.id, DEFAULT_MODEL_ID);

        save(&path, second).unwrap();
        forget(&path, first).unwrap();
        assert_eq!(load(&path), Some(second.id.clone()));
        forget(&path, second).unwrap();
        assert_eq!(load(&path), Some(DEFAULT_MODEL_ID.to_owned()));

        forget(&path, first).unwrap();
        assert_eq!(load(&path), Some(DEFAULT_MODEL_ID.to_owned()));
        let nothing = selection_path(&dir.join("other").join("models"));
        forget(&nothing, second).unwrap();
        assert_eq!(load(&nothing), None);
    }

    #[test]
    fn a_corrector_is_never_the_chosen_transcriber() {
        let dir = temp_dir("corrector");
        let path = selection_path(&dir.join("models"));
        let corrector =
            crate::models::manager::entry(super::super::registry::DEFAULT_CORRECTOR_ID).unwrap();
        assert_eq!(
            save(&path, corrector).unwrap_err(),
            DownloadError::UnknownModel(corrector.id.clone())
        );
        assert_eq!(load(&path), None);
        std::fs::write(&path, format!(r#"{{"modelId":"{}"}}"#, corrector.id)).unwrap();
        assert_eq!(load(&path), None);
    }

    fn corrector() -> &'static ModelEntry {
        crate::models::manager::entry(DEFAULT_CORRECTOR_ID).unwrap()
    }

    #[test]
    fn the_reviewer_choice_is_stored_apart_from_the_transcriber_choice() {
        let dir = temp_dir("reviewer");
        let path = selection_path(&dir.join("models"));
        let (first, second) = models();
        assert_eq!(load_slot(&path, Slot::Reviewer), None);

        save_slot(&path, Slot::Reviewer, corrector()).unwrap();
        assert_eq!(
            load_slot(&path, Slot::Reviewer),
            Some(DEFAULT_CORRECTOR_ID.to_owned())
        );
        assert_eq!(load(&path), None);

        save(&path, second).unwrap();
        assert_eq!(load(&path), Some(second.id.clone()));
        assert_eq!(
            load_slot(&path, Slot::Reviewer),
            Some(DEFAULT_CORRECTOR_ID.to_owned())
        );

        save_slot(&path, Slot::Reviewer, corrector()).unwrap();
        assert_eq!(load(&path), Some(second.id.clone()));
        save(&path, first).unwrap();
        assert_eq!(
            load_slot(&path, Slot::Reviewer),
            Some(DEFAULT_CORRECTOR_ID.to_owned())
        );
    }

    #[test]
    fn a_transcriber_is_never_the_chosen_reviewer() {
        let dir = temp_dir("reviewer-transcriber");
        let path = selection_path(&dir.join("models"));
        let (first, _) = models();
        assert_eq!(
            save_slot(&path, Slot::Reviewer, first).unwrap_err(),
            DownloadError::UnknownModel(first.id.clone())
        );
        assert_eq!(load_slot(&path, Slot::Reviewer), None);
        std::fs::write(&path, format!(r#"{{"reviewerId":"{}"}}"#, first.id)).unwrap();
        assert_eq!(load_slot(&path, Slot::Reviewer), None);
    }

    #[test]
    fn a_selection_file_without_a_reviewer_still_loads() {
        let dir = temp_dir("legacy");
        let path = dir.join(SELECTION_FILE);
        let (_, second) = models();
        std::fs::write(&path, format!(r#"{{"modelId":"{}"}}"#, second.id)).unwrap();
        assert_eq!(load(&path), Some(second.id.clone()));
        assert_eq!(load_slot(&path, Slot::Reviewer), None);
    }

    #[test]
    fn forgetting_a_transcriber_keeps_the_reviewer_choice() {
        let dir = temp_dir("forget-keeps-reviewer");
        let path = selection_path(&dir.join("models"));
        let (_, second) = models();
        save(&path, second).unwrap();
        save_slot(&path, Slot::Reviewer, corrector()).unwrap();
        forget(&path, second).unwrap();
        assert_eq!(load(&path), Some(DEFAULT_MODEL_ID.to_owned()));
        assert_eq!(
            load_slot(&path, Slot::Reviewer),
            Some(DEFAULT_CORRECTOR_ID.to_owned())
        );
        forget(&path, corrector()).unwrap();
        assert_eq!(
            load_slot(&path, Slot::Reviewer),
            Some(DEFAULT_CORRECTOR_ID.to_owned())
        );
    }

    #[test]
    fn each_step_keeps_its_own_text_model_until_that_model_is_deleted() {
        let dir = temp_dir("corrector-slot");
        let path = selection_path(&dir.join("models"));
        let stronger = crate::models::manager::entry("gemma-4-e4b-q4").unwrap();
        assert_eq!(load_slot(&path, Slot::Corrector), None);
        save_slot(&path, Slot::Corrector, stronger).unwrap();
        save_slot(&path, Slot::Reviewer, corrector()).unwrap();
        assert_eq!(load_slot(&path, Slot::Corrector), Some(stronger.id.clone()));
        assert_eq!(
            load_slot(&path, Slot::Reviewer),
            Some(DEFAULT_CORRECTOR_ID.to_owned())
        );
        save_slot(&path, Slot::Reviewer, stronger).unwrap();
        forget(&path, stronger).unwrap();
        assert_eq!(
            load_slot(&path, Slot::Corrector),
            Some(DEFAULT_CORRECTOR_ID.to_owned())
        );
        assert_eq!(
            load_slot(&path, Slot::Reviewer),
            Some(DEFAULT_CORRECTOR_ID.to_owned())
        );
    }

    #[test]
    fn the_selection_lives_next_to_the_models_directory() {
        let path = selection_path(Path::new("/data/app/models"));
        assert_eq!(path, Path::new("/data/app").join(SELECTION_FILE));
    }

    #[test]
    fn unknown_or_damaged_choices_are_ignored() {
        let dir = temp_dir("damaged");
        let path = dir.join(SELECTION_FILE);
        std::fs::write(&path, r#"{"modelId":"removed-from-registry"}"#).unwrap();
        assert_eq!(load(&path), None);
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(load(&path), None);
        std::fs::write(&path, r#"{"modelId":null}"#).unwrap();
        assert_eq!(load(&path), None);
    }

    #[test]
    fn switching_while_idle_has_nothing_to_stop() {
        let (first, second) = models();
        for status in [
            RuntimeStatus::Stopped,
            RuntimeStatus::Failed {
                error: LlmError::NotReady,
            },
        ] {
            assert!(!runs_other_model(&status, second));
            assert!(!serves_model(&status, first));
        }
    }

    #[test]
    fn switching_while_another_model_runs_stops_it() {
        let (first, second) = models();
        assert!(runs_other_model(&ready(first), second));
        assert!(runs_other_model(
            &RuntimeStatus::Starting {
                model: first.files.model.name.clone()
            },
            second
        ));
    }

    #[test]
    fn the_running_model_is_kept_when_its_own_choice_is_confirmed() {
        let (first, _) = models();
        assert!(!runs_other_model(&ready(first), first));
        assert!(serves_model(&ready(first), first));
    }
}
