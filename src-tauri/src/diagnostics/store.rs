use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_LINE_BYTES: usize = 4 * 1024;

pub struct Store {
    current: PathBuf,
    previous: PathBuf,
    max_bytes: u64,
    guard: Mutex<()>,
}

impl Store {
    pub fn new(dir: &Path, max_bytes: u64) -> Self {
        let _ = fs::create_dir_all(dir);
        Self {
            current: dir.join("diagnostics.jsonl"),
            previous: dir.join("diagnostics.1.jsonl"),
            max_bytes,
            guard: Mutex::new(()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, ()> {
        self.guard.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn append(&self, line: &str) {
        let _guard = self.lock();
        let mut line = line.trim_end().to_owned();
        if line.len() > MAX_LINE_BYTES {
            let mut end = MAX_LINE_BYTES;
            while !line.is_char_boundary(end) {
                end -= 1;
            }
            line.truncate(end);
        }
        line.push('\n');
        let size = fs::metadata(&self.current).map_or(0, |meta| meta.len());
        if size > 0
            && size + line.len() as u64 > self.max_bytes
            && fs::rename(&self.current, &self.previous).is_err()
            && fs::write(&self.current, b"").is_err()
        {
            return;
        }
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.current)
        {
            let _ = file.write_all(line.as_bytes());
        }
    }

    pub fn tail(&self, limit: usize) -> Vec<String> {
        let _guard = self.lock();
        let mut lines: Vec<String> = Vec::new();
        for path in [&self.previous, &self.current] {
            let Ok(file) = File::open(path) else { continue };
            lines.extend(BufReader::new(file).lines().map_while(Result::ok));
        }
        let skip = lines.len().saturating_sub(limit);
        lines.split_off(skip)
    }

    pub fn clear(&self) {
        let _guard = self.lock();
        let _ = fs::remove_file(&self.current);
        let _ = fs::remove_file(&self.previous);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rotstift-diag-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn rotates_into_a_single_previous_file_and_stays_bounded() {
        let dir = temp_dir("rotate");
        let store = Store::new(&dir, 200);
        for index in 0..40 {
            store.append(&format!("{{\"n\":{index},\"pad\":\"xxxxxxxxxx\"}}"));
        }
        let current = fs::metadata(dir.join("diagnostics.jsonl")).unwrap().len();
        let previous = fs::metadata(dir.join("diagnostics.1.jsonl")).unwrap().len();
        assert!(current <= 200 && previous <= 200);
        assert!(!dir.join("diagnostics.2.jsonl").exists());
        let tail = store.tail(1000);
        assert!(tail.last().unwrap().contains("\"n\":39"));
        assert!(!tail.iter().any(|line| line.contains("\"n\":0,")));
        let numbers: Vec<u32> = tail
            .iter()
            .map(|line| {
                let value: serde_json::Value = serde_json::from_str(line).unwrap();
                value["n"].as_u64().unwrap() as u32
            })
            .collect();
        assert!(numbers.windows(2).all(|pair| pair[1] == pair[0] + 1));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stays_bounded_when_the_rotation_rename_fails() {
        let dir = temp_dir("blocked");
        let store = Store::new(&dir, 200);
        fs::create_dir_all(dir.join("diagnostics.1.jsonl").join("occupied")).unwrap();
        for index in 0..60 {
            store.append(&format!("{{\"n\":{index},\"pad\":\"xxxxxxxxxx\"}}"));
        }
        let current = fs::metadata(dir.join("diagnostics.jsonl")).unwrap().len();
        assert!(current <= 200);
        assert!(
            store
                .tail(1000)
                .iter()
                .any(|line| line.contains("\"n\":59"))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_returns_only_the_requested_number_of_newest_lines() {
        let dir = temp_dir("tail");
        let store = Store::new(&dir, MAX_FILE_BYTES);
        for index in 0..10 {
            store.append(&format!("line {index}"));
        }
        assert_eq!(store.tail(3), vec!["line 7", "line 8", "line 9"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_lines_are_cut_on_a_char_boundary() {
        let dir = temp_dir("long");
        let store = Store::new(&dir, MAX_FILE_BYTES);
        store.append(&"ä".repeat(MAX_LINE_BYTES));
        let line = &store.tail(1)[0];
        assert!(line.len() <= MAX_LINE_BYTES);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clear_removes_both_files() {
        let dir = temp_dir("clear");
        let store = Store::new(&dir, 50);
        for index in 0..10 {
            store.append(&format!("entry number {index}"));
        }
        store.clear();
        assert!(store.tail(10).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
