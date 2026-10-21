use reqwest::header::RANGE;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};

use super::download::{CustomProblem, DownloadError, network_error};
use super::gguf::{self, GgufInfo};
use super::registry::host_allowed;

const API: &str = "https://huggingface.co/api/models";
const PREFERRED_QUANTS: [&str; 3] = ["q4_k_m", "q4_0", "q8_0"];
const PREFERRED_PROJECTORS: [&str; 3] = ["f16", "bf16", "q8_0"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub repo: String,
    pub revision: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub repo: String,
    pub commit: String,
    pub models: Vec<RemoteFile>,
    pub projectors: Vec<RemoteFile>,
    pub model: Option<String>,
    pub projector: Option<String>,
}

#[derive(Deserialize)]
struct Revision {
    sha: String,
    #[serde(default)]
    gated: serde_json::Value,
}

#[derive(Deserialize)]
struct TreeEntry {
    #[serde(rename = "type")]
    kind: String,
    path: String,
    #[serde(default)]
    size: u64,
    lfs: Option<Lfs>,
}

#[derive(Deserialize)]
struct Lfs {
    oid: String,
}

fn is_name_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !segment.starts_with('.')
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

pub fn parse_link(text: &str) -> Option<Link> {
    let url = Url::parse(text.trim()).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    if url.scheme() != "https" || !matches!(host, "huggingface.co" | "hf.co") {
        return None;
    }
    let segments: Vec<&str> = url.path_segments()?.filter(|s| !s.is_empty()).collect();
    let [owner, name, rest @ ..] = segments.as_slice() else {
        return None;
    };
    if !is_name_segment(owner) || !is_name_segment(name) {
        return None;
    }
    let repo = format!("{owner}/{name}");
    match rest {
        [] => Some(Link {
            repo,
            revision: None,
            path: None,
        }),
        ["tree", revision, ..] if is_name_segment(revision) => Some(Link {
            repo,
            revision: Some((*revision).to_owned()),
            path: None,
        }),
        [kind, revision, path @ ..]
            if matches!(*kind, "blob" | "resolve")
                && is_name_segment(revision)
                && !path.is_empty()
                && path.iter().all(|segment| is_name_segment(segment)) =>
        {
            Some(Link {
                repo,
                revision: Some((*revision).to_owned()),
                path: Some(path.join("/")),
            })
        }
        _ => None,
    }
}

fn is_split(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let Some(stem) = name.strip_suffix(".gguf") else {
        return false;
    };
    let parts: Vec<&str> = stem.rsplitn(4, '-').collect();
    matches!(parts.as_slice(), [total, "of", index, _]
        if total.len() == 5 && index.len() == 5
            && total.bytes().all(|b| b.is_ascii_digit())
            && index.bytes().all(|b| b.is_ascii_digit()))
}

pub fn is_projector_name(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .to_ascii_lowercase()
        .contains("mmproj")
}

fn has_token(path: &str, token: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    name.match_indices(token).any(|(at, _)| {
        let before = name[..at].chars().next_back();
        let after = name[at + token.len()..].chars().next();
        !before.is_some_and(|c| c.is_ascii_alphanumeric())
            && !after.is_some_and(|c| c.is_ascii_alphanumeric())
    })
}

fn preferred(files: &[RemoteFile], order: &[&str]) -> Option<String> {
    order
        .iter()
        .find_map(|quant| files.iter().find(|file| has_token(&file.path, quant)))
        .or(files.first())
        .map(|file| file.path.clone())
}

fn split_tree(
    entries: Vec<TreeEntry>,
) -> Result<(Vec<RemoteFile>, Vec<RemoteFile>), DownloadError> {
    let mut models = Vec::new();
    let mut projectors = Vec::new();
    let mut split = false;
    for entry in entries {
        if entry.kind != "file" || !entry.path.to_ascii_lowercase().ends_with(".gguf") {
            continue;
        }
        if is_split(&entry.path) {
            split = true;
            continue;
        }
        let Some(lfs) = entry.lfs else { continue };
        let file = RemoteFile {
            path: entry.path,
            bytes: entry.size,
            sha256: lfs.oid,
        };
        if is_projector_name(&file.path) {
            projectors.push(file);
        } else {
            models.push(file);
        }
    }
    if models.is_empty() {
        let problem = if split {
            CustomProblem::SplitFile
        } else {
            CustomProblem::NoGguf
        };
        return Err(DownloadError::Custom(problem));
    }
    Ok((models, projectors))
}

fn api_error(status: StatusCode) -> DownloadError {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            DownloadError::Custom(CustomProblem::Gated)
        }
        StatusCode::NOT_FOUND => DownloadError::Custom(CustomProblem::NotFound),
        status => DownloadError::Http {
            status: status.as_u16(),
        },
    }
}

async fn get_json<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
) -> Result<T, DownloadError> {
    let response = client.get(url).send().await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(api_error(response.status()));
    }
    response
        .json::<T>()
        .await
        .map_err(|error| DownloadError::Network(error.without_url().to_string()))
}

async fn tree(client: &Client, repo: &str, commit: &str) -> Result<Vec<TreeEntry>, DownloadError> {
    get_json(
        client,
        &format!("{API}/{repo}/tree/{commit}?recursive=true"),
    )
    .await
}

pub async fn resolve(client: &Client, link: &Link) -> Result<Resolved, DownloadError> {
    let revision = link.revision.as_deref().unwrap_or("main");
    let found: Revision =
        get_json(client, &format!("{API}/{}/revision/{revision}", link.repo)).await?;
    if !matches!(
        found.gated,
        serde_json::Value::Bool(false) | serde_json::Value::Null
    ) {
        return Err(DownloadError::Custom(CustomProblem::Gated));
    }
    let (models, projectors) = split_tree(tree(client, &link.repo, &found.sha).await?)?;
    let model = match &link.path {
        Some(path) if is_projector_name(path) => {
            return Err(DownloadError::Custom(CustomProblem::Projector {
                file: path.clone(),
            }));
        }
        Some(path) if is_split(path) => {
            return Err(DownloadError::Custom(CustomProblem::SplitFile));
        }
        Some(path) if models.iter().any(|file| &file.path == path) => Some(path.clone()),
        Some(_) => return Err(DownloadError::Custom(CustomProblem::NotFound)),
        None => preferred(&models, &PREFERRED_QUANTS),
    };
    let projector = preferred(&projectors, &PREFERRED_PROJECTORS);
    Ok(Resolved {
        repo: link.repo.clone(),
        commit: found.sha,
        models,
        projectors,
        model,
        projector,
    })
}

pub async fn files(
    client: &Client,
    repo: &str,
    commit: &str,
    paths: &[&str],
) -> Result<Vec<RemoteFile>, DownloadError> {
    let (models, projectors) = split_tree(tree(client, repo, commit).await?)?;
    paths
        .iter()
        .map(|path| {
            models
                .iter()
                .chain(&projectors)
                .find(|file| file.path == *path)
                .cloned()
                .ok_or(DownloadError::Custom(CustomProblem::NotFound))
        })
        .collect()
}

pub fn file_url(repo: &str, commit: &str, path: &str) -> String {
    format!("https://huggingface.co/{repo}/resolve/{commit}/{path}")
}

pub async fn header(client: &Client, url: &str) -> Result<Option<GgufInfo>, DownloadError> {
    let parsed = Url::parse(url).map_err(|_| DownloadError::NotAllowed(url.into()))?;
    if !parsed.host_str().is_some_and(host_allowed) {
        return Err(DownloadError::NotAllowed(url.into()));
    }
    let mut response = client
        .get(url)
        .header(RANGE, format!("bytes=0-{}", gguf::HEADER_BYTES - 1))
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(api_error(response.status()));
    }
    let mut bytes = Vec::with_capacity(gguf::HEADER_BYTES);
    while bytes.len() < gguf::HEADER_BYTES {
        match response.chunk().await.map_err(network_error)? {
            Some(chunk) => bytes.extend_from_slice(&chunk),
            None => break,
        }
    }
    bytes.truncate(gguf::HEADER_BYTES);
    Ok(gguf::parse(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(text: &str) -> Option<Link> {
        parse_link(text)
    }

    #[test]
    fn understands_repo_file_and_tree_links() {
        assert_eq!(
            link("https://huggingface.co/ibm-granite/granite-4.2-3b-GGUF"),
            Some(Link {
                repo: "ibm-granite/granite-4.2-3b-GGUF".into(),
                revision: None,
                path: None,
            })
        );
        assert_eq!(
            link("https://hf.co/a/b/blob/main/sub/model-Q4_K_M.gguf?download=true"),
            Some(Link {
                repo: "a/b".into(),
                revision: Some("main".into()),
                path: Some("sub/model-Q4_K_M.gguf".into()),
            })
        );
        assert_eq!(
            link("https://www.huggingface.co/a/b/tree/main/"),
            Some(Link {
                repo: "a/b".into(),
                revision: Some("main".into()),
                path: None,
            })
        );
        assert_eq!(
            link(" https://huggingface.co/a/b/resolve/0123abc/m.gguf ")
                .unwrap()
                .path
                .as_deref(),
            Some("m.gguf")
        );
    }

    #[test]
    fn rejects_other_hosts_and_shapes() {
        for text in [
            "http://huggingface.co/a/b",
            "https://huggingface.co.evil.com/a/b",
            "https://github.com/a/b",
            "https://huggingface.co/a",
            "https://huggingface.co/a/b/discussions/1",
            "https://huggingface.co/a/b/blob/main/../x.gguf",
            "https://huggingface.co/../b",
            "ibm-granite/granite",
            "",
        ] {
            assert_eq!(link(text), None, "{text}");
        }
    }

    #[test]
    fn recognises_split_and_projector_files() {
        assert!(is_split("Q4/model-00001-of-00003.gguf"));
        assert!(!is_split("model-Q4_K_M.gguf"));
        assert!(!is_split("model-1-of-3.gguf"));
        assert!(is_projector_name("dir/mmproj-model-f16.gguf"));
        assert!(is_projector_name("MMPROJ-F16.gguf"));
        assert!(!is_projector_name("Qwen3.5-4B-Q4_K_M.gguf"));
    }

    fn entry(path: &str, lfs: bool) -> TreeEntry {
        TreeEntry {
            kind: "file".into(),
            path: path.into(),
            size: 10,
            lfs: lfs.then(|| Lfs {
                oid: "a".repeat(64),
            }),
        }
    }

    #[test]
    fn splits_the_tree_into_models_and_projectors() {
        let (models, projectors) = split_tree(vec![
            entry("README.md", false),
            entry("m-Q8_0.gguf", true),
            entry("m-Q4_K_M.gguf", true),
            entry("mmproj-BF16.gguf", true),
            entry("mmproj-F16.gguf", true),
            entry("big-00001-of-00002.gguf", true),
        ])
        .unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(
            preferred(&models, &PREFERRED_QUANTS).as_deref(),
            Some("m-Q4_K_M.gguf")
        );
        assert_eq!(
            preferred(&projectors, &PREFERRED_PROJECTORS).as_deref(),
            Some("mmproj-F16.gguf")
        );
    }

    #[test]
    fn a_tree_without_single_gguf_files_is_rejected() {
        assert_eq!(
            split_tree(vec![entry("big-00001-of-00002.gguf", true)]).unwrap_err(),
            DownloadError::Custom(CustomProblem::SplitFile)
        );
        assert_eq!(
            split_tree(vec![
                entry("README.md", false),
                entry("mmproj-F16.gguf", true)
            ])
            .unwrap_err(),
            DownloadError::Custom(CustomProblem::NoGguf)
        );
    }

    #[test]
    fn maps_access_errors() {
        assert_eq!(
            api_error(StatusCode::UNAUTHORIZED),
            DownloadError::Custom(CustomProblem::Gated)
        );
        assert_eq!(
            api_error(StatusCode::NOT_FOUND),
            DownloadError::Custom(CustomProblem::NotFound)
        );
        assert_eq!(
            api_error(StatusCode::BAD_GATEWAY),
            DownloadError::Http { status: 502 }
        );
    }
}
