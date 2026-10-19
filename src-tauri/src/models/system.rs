use std::path::{Path, PathBuf};

use sysinfo::{Disks, MemoryRefreshKind, RefreshKind, System};

pub fn total_memory() -> u64 {
    let refresh = RefreshKind::nothing().with_memory(MemoryRefreshKind::nothing().with_ram());
    System::new_with_specifics(refresh).total_memory()
}

fn without_verbatim_prefix(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|text| text.strip_prefix(r"\\?\")) {
        Some(plain) => PathBuf::from(plain),
        None => path,
    }
}

pub fn free_space(path: &Path) -> Option<u64> {
    let path = without_verbatim_prefix(path.canonicalize().ok()?);
    Disks::new_with_refreshed_list()
        .list()
        .iter()
        .filter(|disk| path.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .map(|disk| disk.available_space())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_memory_and_free_space_for_an_existing_directory() {
        assert!(total_memory() > 0);
        assert!(free_space(&std::env::temp_dir()).is_some_and(|bytes| bytes > 0));
        assert!(free_space(Path::new("/does/not/exist/at/all")).is_none());
    }
}
