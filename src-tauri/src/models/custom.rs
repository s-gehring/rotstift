use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::download::{CustomProblem, DownloadError, hex_digest, import_path};
use super::gguf;
use super::hf;
use super::registry::{
    ModelEntry, ModelFile, ModelFiles, Registry, RequestParams, Role, ServerParams, is_hex,
    is_plain_gguf_name, registry, url_allowed,
};
use super::verified::{has_valid_marker, write_marker};

const CUSTOM_FILE: &str = "custom-models.json";
const VERSION: u32 = 1;
const COPY_BUFFER: usize = 1024 * 1024;
const FREE_SPACE_RESERVE: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Source {
    HuggingFace { repo: String, revision: String },
    File,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomModel {
    pub id: String,
    pub role: Role,
    pub source: Source,
    pub files: ModelFiles,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Stored {
    version: u32,
    models: Vec<CustomModel>,
}

pub fn custom_path(models_dir: &Path) -> PathBuf {
    models_dir.parent().unwrap_or(models_dir).join(CUSTOM_FILE)
}

pub fn model_id(files: &ModelFiles) -> String {
    let mut hasher = Sha256::new();
    hasher.update(files.model.sha256.as_bytes());
    if let Some(mmproj) = &files.mmproj {
        hasher.update(mmproj.sha256.as_bytes());
    }
    format!("custom-{}", &hex_digest(hasher)[..12])
}

fn validate_file(file: &ModelFile, source: &Source) -> Result<(), String> {
    if !is_plain_gguf_name(&file.name) || !is_hex(&file.sha256, 64) || file.bytes == 0 {
        return Err(format!("invalid file {}", file.name));
    }
    let valid_url = match source {
        Source::File => file.url.is_empty(),
        Source::HuggingFace { repo, revision } => {
            is_hex(revision, 40)
                && Url::parse(&file.url).is_ok_and(|url| url_allowed(&url))
                && file.url.starts_with(&format!(
                    "https://huggingface.co/{repo}/resolve/{revision}/"
                ))
        }
    };
    if valid_url {
        Ok(())
    } else {
        Err(format!("invalid url for {}", file.name))
    }
}

pub fn validate(model: &CustomModel) -> Result<(), String> {
    if model.id != model_id(&model.files) {
        return Err(format!("id {} does not match its files", model.id));
    }
    if (model.role == Role::Transcriber) != model.files.mmproj.is_some() {
        return Err(format!("model {}: mmproj does not fit the role", model.id));
    }
    if model.files.draft.is_some() {
        return Err(format!("model {}: own models take no draft", model.id));
    }
    validate_file(&model.files.model, &model.source)?;
    if let Some(mmproj) = &model.files.mmproj {
        validate_file(mmproj, &model.source)?;
    }
    Ok(())
}

pub fn entry(registry: &Registry, model: &CustomModel) -> ModelEntry {
    let template = registry.template(model.role);
    ModelEntry {
        id: model.id.clone(),
        role: model.role,
        display_name: model.files.model.name.clone(),
        license: String::new(),
        recommended_ram_gb: template.recommended_ram_gb,
        files: model.files.clone(),
        server: ServerParams {
            cpu_repack: false,
            ..template.server.clone()
        },
        request: RequestParams {
            uncertain_below: None,
            ..template.request.clone()
        },
        line_mode: template.line_mode,
        system: template.system.clone(),
        prompt: template.prompt.clone(),
    }
}

pub struct Catalog {
    path: PathBuf,
    models: Vec<CustomModel>,
    entries: HashMap<String, &'static ModelEntry>,
}

impl Catalog {
    pub fn open(path: PathBuf) -> Self {
        let stored: Stored = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        let mut catalog = Self {
            path,
            models: Vec::new(),
            entries: HashMap::new(),
        };
        if stored.version == VERSION {
            for model in stored.models {
                if validate(&model).is_ok() && catalog.position(&model.id).is_none() {
                    catalog.insert(model);
                }
            }
        }
        catalog
    }

    fn position(&self, id: &str) -> Option<usize> {
        self.models.iter().position(|model| model.id == id)
    }

    fn insert(&mut self, model: CustomModel) {
        if let Ok(registry) = registry()
            && !self.entries.contains_key(&model.id)
        {
            let leaked: &'static ModelEntry = Box::leak(Box::new(entry(registry, &model)));
            self.entries.insert(model.id.clone(), leaked);
        }
        self.models.push(model);
    }

    pub fn models(&self) -> &[CustomModel] {
        &self.models
    }

    pub fn find(&self, id: &str) -> Option<&'static ModelEntry> {
        self.position(id)?;
        self.entries.get(id).copied()
    }

    fn known_files(&self) -> impl Iterator<Item = &ModelFile> {
        let registered = registry()
            .map(|registry| registry.models.as_slice())
            .unwrap_or_default();
        registered
            .iter()
            .flat_map(|entry| entry.file_list())
            .chain(self.models.iter().flat_map(|model| {
                std::iter::once(&model.files.model).chain(model.files.mmproj.as_ref())
            }))
    }

    pub fn name_for(&self, wanted: &str, sha256: &str) -> String {
        let mut taken = false;
        for file in self.known_files() {
            if file.sha256 == sha256 {
                return file.name.clone();
            }
            taken |= file.name == wanted;
        }
        if taken {
            format!("{}-{wanted}", &sha256[..8])
        } else {
            wanted.to_owned()
        }
    }

    pub fn file_in_use(&self, name: &str, except: &str) -> bool {
        let registered = registry()
            .map(|registry| registry.models.as_slice())
            .unwrap_or_default();
        registered
            .iter()
            .filter(|entry| entry.id != except)
            .flat_map(|entry| entry.file_list())
            .chain(
                self.models
                    .iter()
                    .filter(|model| model.id != except)
                    .flat_map(|model| {
                        std::iter::once(&model.files.model).chain(model.files.mmproj.as_ref())
                    }),
            )
            .any(|file| file.name == name)
    }

    pub fn add(&mut self, model: CustomModel) -> Result<String, DownloadError> {
        validate(&model).map_err(DownloadError::Io)?;
        let same_files = |files: &ModelFiles| {
            files.model.sha256 == model.files.model.sha256
                && files.mmproj.as_ref().map(|file| &file.sha256)
                    == model.files.mmproj.as_ref().map(|file| &file.sha256)
        };
        if let Some(existing) = registry().ok().and_then(|registry| {
            registry
                .models
                .iter()
                .find(|entry| entry.role == model.role && same_files(&entry.files))
        }) {
            return Ok(existing.id.clone());
        }
        if self.position(&model.id).is_some() {
            return Ok(model.id);
        }
        let id = model.id.clone();
        self.insert(model);
        if let Err(error) = self.save() {
            self.models.pop();
            return Err(error);
        }
        Ok(id)
    }

    pub fn remove(&mut self, id: &str) -> Result<(), DownloadError> {
        if let Some(index) = self.position(id) {
            let removed = self.models.remove(index);
            if let Err(error) = self.save() {
                self.models.insert(index, removed);
                return Err(error);
            }
        }
        Ok(())
    }

    fn save(&self) -> Result<(), DownloadError> {
        let text = serde_json::to_string_pretty(&Stored {
            version: VERSION,
            models: self.models.clone(),
        })
        .map_err(|error| DownloadError::Io(error.to_string()))?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temp = self.path.with_extension("json.tmp");
        std::fs::write(&temp, text)?;
        std::fs::rename(&temp, &self.path)?;
        Ok(())
    }
}

static CATALOG: OnceLock<Mutex<Catalog>> = OnceLock::new();

pub fn init(models_dir: &Path) {
    let _ = CATALOG.set(Mutex::new(Catalog::open(custom_path(models_dir))));
}

pub fn catalog() -> Option<MutexGuard<'static, Catalog>> {
    CATALOG
        .get()
        .map(|catalog| catalog.lock().unwrap_or_else(|p| p.into_inner()))
}

pub fn find(id: &str) -> Option<&'static ModelEntry> {
    catalog()?.find(id)
}

pub fn plain_name(path: &str) -> String {
    let base = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let stem = base
        .strip_suffix(".gguf")
        .or_else(|| base.strip_suffix(".GGUF"))
        .unwrap_or(base);
    let cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_start_matches('.');
    format!(
        "{}.gguf",
        if cleaned.is_empty() { "model" } else { cleaned }
    )
}

fn problem(problem: CustomProblem) -> DownloadError {
    DownloadError::Custom(problem)
}

pub async fn from_link(
    client: &Client,
    role: Role,
    repo: &str,
    commit: &str,
    model_path: &str,
    projector_path: Option<&str>,
) -> Result<CustomModel, DownloadError> {
    if !is_hex(commit, 40) {
        return Err(problem(CustomProblem::NoLink));
    }
    let projector_path = match (role, projector_path) {
        (Role::Transcriber, None) => return Err(problem(CustomProblem::NoProjector)),
        (Role::Transcriber, Some(path)) => Some(path),
        (Role::Corrector, _) => None,
    };
    let paths: Vec<&str> = std::iter::once(model_path).chain(projector_path).collect();
    let remote = hf::files(client, repo, commit, &paths).await?;
    let mut files = Vec::new();
    for (index, file) in remote.iter().enumerate() {
        let url = hf::file_url(repo, commit, &file.path);
        let info = hf::header(client, &url).await?.ok_or_else(|| {
            problem(CustomProblem::NotGguf {
                file: file.path.clone(),
            })
        })?;
        match (index, info.is_projector()) {
            (0, true) => {
                return Err(problem(CustomProblem::Projector {
                    file: file.path.clone(),
                }));
            }
            (1, false) => return Err(problem(CustomProblem::NoProjector)),
            _ => {}
        }
        files.push((file.clone(), url));
    }
    let mut files = files.into_iter();
    let name_of = |file: &hf::RemoteFile| {
        catalog().map_or_else(
            || plain_name(&file.path),
            |catalog| catalog.name_for(&plain_name(&file.path), &file.sha256),
        )
    };
    let to_file = |(file, url): (hf::RemoteFile, String)| ModelFile {
        name: name_of(&file),
        url,
        sha256: file.sha256,
        bytes: file.bytes,
    };
    let model = files
        .next()
        .map(to_file)
        .ok_or(problem(CustomProblem::NoGguf))?;
    let files = ModelFiles {
        model,
        mmproj: files.next().map(to_file),
        draft: None,
    };
    Ok(CustomModel {
        id: model_id(&files),
        role,
        source: Source::HuggingFace {
            repo: repo.to_owned(),
            revision: commit.to_owned(),
        },
        files,
    })
}

struct Picked {
    path: PathBuf,
    projector: bool,
}

fn classify(sources: &[PathBuf]) -> Result<Vec<Picked>, DownloadError> {
    sources
        .iter()
        .map(|path| {
            let info = gguf::read_file(path)?.ok_or_else(|| {
                problem(CustomProblem::NotGguf {
                    file: path
                        .file_name()
                        .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
                })
            })?;
            Ok(Picked {
                path: path.clone(),
                projector: info.is_projector(),
            })
        })
        .collect()
}

fn sha256_of(path: &Path) -> std::io::Result<String> {
    let mut reader = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_BUFFER];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(hex_digest(hasher));
        }
        hasher.update(&buffer[..read]);
    }
}

fn install(
    source: &Path,
    file: &ModelFile,
    dir: &Path,
    free_space: impl Fn(&Path) -> Option<u64>,
) -> Result<(), DownloadError> {
    let target = dir.join(&file.name);
    if has_valid_marker(dir, file) {
        return Ok(());
    }
    let same = std::fs::canonicalize(source)
        .ok()
        .is_some_and(|source| std::fs::canonicalize(&target).ok() == Some(source));
    if same {
        return write_marker(dir, file);
    }
    let _ = std::fs::remove_file(&target);
    if std::fs::hard_link(source, &target).is_err() {
        if let Some(available) = free_space(dir)
            && available < file.bytes + FREE_SPACE_RESERVE
        {
            return Err(DownloadError::InsufficientDisk {
                needed: file.bytes + FREE_SPACE_RESERVE,
                available,
            });
        }
        let temp = import_path(dir, file);
        let copied = std::fs::copy(source, &temp).and_then(|_| std::fs::rename(&temp, &target));
        if let Err(error) = copied {
            let _ = std::fs::remove_file(&temp);
            return Err(error.into());
        }
    }
    write_marker(dir, file)
}

pub fn from_files(
    dir: &Path,
    role: Role,
    sources: &[PathBuf],
    name_for: impl Fn(&str, &str) -> String,
    free_space: impl Fn(&Path) -> Option<u64>,
) -> Result<CustomModel, DownloadError> {
    let picked = classify(sources)?;
    let (projectors, models): (Vec<&Picked>, Vec<&Picked>) =
        picked.iter().partition(|picked| picked.projector);
    let wanted_projectors = usize::from(role == Role::Transcriber);
    let [model] = models.as_slice() else {
        return Err(match (models.len(), projectors.first()) {
            (0, Some(projector)) => problem(CustomProblem::Projector {
                file: plain_name(&projector.path.to_string_lossy()),
            }),
            _ => problem(CustomProblem::TooManyFiles),
        });
    };
    if projectors.len() > wanted_projectors {
        return Err(if role == Role::Corrector {
            problem(CustomProblem::Projector {
                file: plain_name(&projectors[0].path.to_string_lossy()),
            })
        } else {
            problem(CustomProblem::TooManyFiles)
        });
    }
    if projectors.len() < wanted_projectors {
        return Err(problem(CustomProblem::NoProjector));
    }
    std::fs::create_dir_all(dir)?;
    let mut installed = Vec::new();
    for picked in std::iter::once(*model).chain(projectors.first().copied()) {
        let sha256 = sha256_of(&picked.path)?;
        let file = ModelFile {
            name: name_for(&plain_name(&picked.path.to_string_lossy()), &sha256),
            url: String::new(),
            sha256,
            bytes: std::fs::metadata(&picked.path)?.len(),
        };
        install(&picked.path, &file, dir, &free_space)?;
        installed.push(file);
    }
    let mut installed = installed.into_iter();
    let files = ModelFiles {
        model: installed.next().ok_or(problem(CustomProblem::NoGguf))?,
        mmproj: installed.next(),
        draft: None,
    };
    Ok(CustomModel {
        id: model_id(&files),
        role,
        source: Source::File,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::gguf::header;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rotstift-custom-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, name: &str, architecture: &str, extra: &[u8]) -> PathBuf {
        let path = dir.join(name);
        let mut bytes = header(architecture);
        bytes.extend(extra);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn keep_name(wanted: &str, _sha: &str) -> String {
        wanted.to_owned()
    }

    fn no_space_check(_: &Path) -> Option<u64> {
        None
    }

    #[test]
    fn imports_a_text_model_by_linking_it_into_the_models_folder() {
        let dir = temp_dir("text");
        let source = write(&dir, "My Model Q4.gguf", "qwen3", b"weights");
        let models = dir.join("models");
        let model = from_files(
            &models,
            Role::Corrector,
            std::slice::from_ref(&source),
            keep_name,
            no_space_check,
        )
        .unwrap();
        assert_eq!(model.files.model.name, "My-Model-Q4.gguf");
        assert_eq!(model.source, Source::File);
        assert!(model.files.mmproj.is_none());
        assert!(validate(&model).is_ok());
        assert!(has_valid_marker(&models, &model.files.model));
        std::fs::remove_file(&source).unwrap();
        assert!(models.join("My-Model-Q4.gguf").is_file());
    }

    #[test]
    fn a_transcriber_needs_exactly_one_projector() {
        let dir = temp_dir("vision");
        let model = write(&dir, "vl.gguf", "qwen3vl", b"m");
        let projector = write(&dir, "proj.gguf", "clip", b"p");
        let models = dir.join("models");
        assert_eq!(
            from_files(
                &models,
                Role::Transcriber,
                std::slice::from_ref(&model),
                keep_name,
                no_space_check
            )
            .unwrap_err(),
            DownloadError::Custom(CustomProblem::NoProjector)
        );
        assert_eq!(
            from_files(
                &models,
                Role::Corrector,
                &[model.clone(), projector.clone()],
                keep_name,
                no_space_check
            )
            .unwrap_err(),
            DownloadError::Custom(CustomProblem::Projector {
                file: "proj.gguf".into()
            })
        );
        assert_eq!(
            from_files(
                &models,
                Role::Transcriber,
                std::slice::from_ref(&projector),
                keep_name,
                no_space_check
            )
            .unwrap_err(),
            DownloadError::Custom(CustomProblem::Projector {
                file: "proj.gguf".into()
            })
        );
        let imported = from_files(
            &models,
            Role::Transcriber,
            &[projector, model],
            keep_name,
            no_space_check,
        )
        .unwrap();
        assert_eq!(imported.files.model.name, "vl.gguf");
        assert_eq!(imported.files.mmproj.unwrap().name, "proj.gguf");
    }

    #[test]
    fn rejects_files_that_are_not_gguf() {
        let dir = temp_dir("not-gguf");
        let path = dir.join("notes.gguf");
        std::fs::write(&path, b"hello").unwrap();
        assert_eq!(
            from_files(
                &dir.join("models"),
                Role::Corrector,
                &[path],
                keep_name,
                no_space_check
            )
            .unwrap_err(),
            DownloadError::Custom(CustomProblem::NotGguf {
                file: "notes.gguf".into()
            })
        );
    }

    fn hf_model() -> CustomModel {
        let commit = "c40945d71cd90f249a56985e8155551a9188dc30";
        let files = ModelFiles {
            model: ModelFile {
                name: "granite-4.2-3b-Q4_K_M.gguf".into(),
                url: hf::file_url(
                    "ibm-granite/granite-4.2-3b-GGUF",
                    commit,
                    "granite-4.2-3b-Q4_K_M.gguf",
                ),
                sha256: "e0406663965846ae22a403456eb826ccce5f450840491f71952f18a7cb78e7d5".into(),
                bytes: 2_244_011_552,
            },
            mmproj: None,
            draft: None,
        };
        CustomModel {
            id: model_id(&files),
            role: Role::Corrector,
            source: Source::HuggingFace {
                repo: "ibm-granite/granite-4.2-3b-GGUF".into(),
                revision: commit.into(),
            },
            files,
        }
    }

    #[test]
    fn validation_pins_links_and_ties_the_id_to_the_files() {
        let model = hf_model();
        assert!(validate(&model).is_ok());
        let mut moved = model.clone();
        moved.files.model.url = moved.files.model.url.replace("c40945d7", "main0000");
        assert!(validate(&moved).is_err());
        let mut renamed = model.clone();
        renamed.id = "custom-000000000000".into();
        assert!(validate(&renamed).is_err());
        let mut with_draft = model.clone();
        with_draft.files.draft = Some(model.files.model.clone());
        assert!(validate(&with_draft).is_err());
        let mut local_with_url = model;
        local_with_url.source = Source::File;
        assert!(validate(&local_with_url).is_err());
    }

    #[test]
    fn the_catalog_keeps_its_models_across_restarts_and_skips_broken_entries() {
        let dir = temp_dir("catalog");
        let path = custom_path(&dir.join("models"));
        let mut catalog = Catalog::open(path.clone());
        let id = catalog.add(hf_model()).unwrap();
        assert_eq!(catalog.add(hf_model()).unwrap(), id);
        assert_eq!(catalog.models().len(), 1);
        let entry = catalog.find(&id).unwrap();
        assert_eq!(entry.role, Role::Corrector);
        assert_eq!(entry.files.draft, None);
        assert!(!entry.server.cpu_repack);
        assert_eq!(
            entry.prompt,
            registry().unwrap().template(Role::Corrector).prompt
        );

        let mut stored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(stored["models"][0]["files"].get("draft").is_none());
        let mut broken = stored["models"][0].clone();
        broken["id"] = "custom-ffffffffffff".into();
        stored["models"].as_array_mut().unwrap().push(broken);
        std::fs::write(&path, stored.to_string()).unwrap();

        let mut reopened = Catalog::open(path);
        assert_eq!(reopened.models().len(), 1);
        assert!(reopened.find(&id).is_some());
        reopened.remove(&id).unwrap();
        assert!(reopened.find(&id).is_none());
        assert!(reopened.models().is_empty());
    }

    #[test]
    fn a_link_to_a_listed_model_reuses_the_listed_entry() {
        let dir = temp_dir("listed");
        let mut catalog = Catalog::open(custom_path(&dir.join("models")));
        let listed = registry().unwrap().find("gemma-4-e4b-q4").unwrap();
        let commit = "a69f018d7678a2b9f5e705f8903d6fb29b9b25dc";
        let files = ModelFiles {
            model: ModelFile {
                url: hf::file_url(
                    "ggml-org/gemma-4-E4B-it-GGUF",
                    commit,
                    &listed.files.model.name,
                ),
                ..listed.files.model.clone()
            },
            mmproj: None,
            draft: None,
        };
        let model = CustomModel {
            id: model_id(&files),
            role: Role::Corrector,
            source: Source::HuggingFace {
                repo: "ggml-org/gemma-4-E4B-it-GGUF".into(),
                revision: commit.into(),
            },
            files,
        };
        assert_eq!(catalog.add(model).unwrap(), "gemma-4-e4b-q4");
        assert!(catalog.models().is_empty());
    }

    #[test]
    fn names_never_collide_with_other_files() {
        let dir = temp_dir("names");
        let mut catalog = Catalog::open(custom_path(&dir.join("models")));
        let listed = &registry()
            .unwrap()
            .find("gemma-4-e2b-q4")
            .unwrap()
            .files
            .model;
        assert_eq!(catalog.name_for("other.gguf", &listed.sha256), listed.name);
        let different = "1".repeat(64);
        assert_eq!(
            catalog.name_for(&listed.name, &different),
            format!("11111111-{}", listed.name)
        );
        let model = hf_model();
        let name = model.files.model.name.clone();
        let id = catalog.add(model).unwrap();
        assert!(catalog.file_in_use(&name, "gemma-4-e2b-q4"));
        assert!(!catalog.file_in_use(&name, &id));
        assert!(catalog.file_in_use(&listed.name, &id));
    }

    #[test]
    fn plain_names_fit_the_models_folder() {
        assert_eq!(plain_name("dir/sub/Model Q4.GGUF"), "Model-Q4.gguf");
        assert_eq!(plain_name("C:\\x\\..gguf"), "model.gguf");
        assert_eq!(plain_name("mmproj-F16.gguf"), "mmproj-F16.gguf");
        assert!(is_plain_gguf_name(&plain_name("ü ä.gguf")));
    }
}
