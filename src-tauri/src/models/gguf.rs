use std::io::Read;
use std::path::Path;

pub const HEADER_BYTES: usize = 4 * 1024 * 1024;
const MAGIC: &[u8; 4] = b"GGUF";
const PROJECTOR_ARCHITECTURE: &str = "clip";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GgufInfo {
    pub architecture: Option<String>,
}

impl GgufInfo {
    pub fn is_projector(&self) -> bool {
        self.architecture.as_deref() == Some(PROJECTOR_ARCHITECTURE)
    }
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(len)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn string(&mut self) -> Option<&'a [u8]> {
        let len = usize::try_from(self.u64()?).ok()?;
        self.take(len)
    }

    fn skip_value(&mut self, kind: u32) -> Option<()> {
        match kind {
            0 | 1 | 7 => self.take(1).map(drop),
            2 | 3 => self.take(2).map(drop),
            4..=6 => self.take(4).map(drop),
            10..=12 => self.take(8).map(drop),
            8 => self.string().map(drop),
            9 => {
                let inner = self.u32()?;
                let len = self.u64()?;
                for _ in 0..len {
                    self.skip_value(inner)?;
                }
                Some(())
            }
            _ => None,
        }
    }
}

pub fn parse(bytes: &[u8]) -> Option<GgufInfo> {
    let mut cursor = Cursor { bytes, at: 0 };
    if cursor.take(4)? != MAGIC {
        return None;
    }
    let version = cursor.u32()?;
    if !(2..=3).contains(&version) {
        return None;
    }
    let mut info = GgufInfo { architecture: None };
    let (Some(_tensors), Some(pairs)) = (cursor.u64(), cursor.u64()) else {
        return Some(info);
    };
    for _ in 0..pairs {
        let Some(key) = cursor.string() else { break };
        let Some(kind) = cursor.u32() else { break };
        if key == b"general.architecture" && kind == 8 {
            info.architecture = cursor
                .string()
                .map(|value| String::from_utf8_lossy(value).into_owned());
            break;
        }
        if cursor.skip_value(kind).is_none() {
            break;
        }
    }
    Some(info)
}

pub fn read_file(path: &Path) -> std::io::Result<Option<GgufInfo>> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES);
    std::fs::File::open(path)?
        .take(HEADER_BYTES as u64)
        .read_to_end(&mut bytes)?;
    Ok(parse(&bytes))
}

#[cfg(test)]
pub(crate) fn header(architecture: &str) -> Vec<u8> {
    let mut bytes = MAGIC.to_vec();
    bytes.extend(3u32.to_le_bytes());
    bytes.extend(0u64.to_le_bytes());
    bytes.extend(2u64.to_le_bytes());
    let key = b"general.alignment";
    bytes.extend((key.len() as u64).to_le_bytes());
    bytes.extend(key);
    bytes.extend(4u32.to_le_bytes());
    bytes.extend(32u32.to_le_bytes());
    let key = b"general.architecture";
    bytes.extend((key.len() as u64).to_le_bytes());
    bytes.extend(key);
    bytes.extend(8u32.to_le_bytes());
    bytes.extend((architecture.len() as u64).to_le_bytes());
    bytes.extend(architecture.as_bytes());
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_architecture_after_other_keys() {
        let info = parse(&header("gemma4")).unwrap();
        assert_eq!(info.architecture.as_deref(), Some("gemma4"));
        assert!(!info.is_projector());
        assert!(parse(&header("clip")).unwrap().is_projector());
    }

    #[test]
    fn skips_arrays_before_the_architecture() {
        let mut bytes = MAGIC.to_vec();
        bytes.extend(3u32.to_le_bytes());
        bytes.extend(0u64.to_le_bytes());
        bytes.extend(2u64.to_le_bytes());
        let key = b"tokenizer.ggml.tokens";
        bytes.extend((key.len() as u64).to_le_bytes());
        bytes.extend(key);
        bytes.extend(9u32.to_le_bytes());
        bytes.extend(8u32.to_le_bytes());
        bytes.extend(2u64.to_le_bytes());
        for token in [&b"a"[..], b"bc"] {
            bytes.extend((token.len() as u64).to_le_bytes());
            bytes.extend(token);
        }
        let tail = header("qwen3");
        bytes.extend(&tail[24 + 8 + 17 + 4 + 4..]);
        assert_eq!(
            parse(&bytes).unwrap().architecture.as_deref(),
            Some("qwen3")
        );
    }

    #[test]
    fn a_cut_header_still_counts_as_gguf() {
        let full = header("llama");
        let info = parse(&full[..30]).unwrap();
        assert_eq!(info.architecture, None);
    }

    #[test]
    fn rejects_other_files() {
        assert_eq!(parse(b"PK\x03\x04 not a model"), None);
        let mut wrong_version = header("llama");
        wrong_version[4] = 9;
        assert_eq!(parse(&wrong_version), None);
        assert_eq!(parse(b"GG"), None);
    }
}
