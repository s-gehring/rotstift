use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    let words: Vec<String> = io::stdin().lock().lines().collect::<Result<_, _>>()?;
    let unknown = rotstift_lib::unknown_words(&words).map_err(io::Error::other)?;
    let mut out = io::stdout().lock();
    for word in unknown {
        writeln!(out, "{word}")?;
    }
    Ok(())
}
