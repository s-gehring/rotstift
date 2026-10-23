use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use serde_json::{Value, json};

use super::claude::Claude;
use super::{Runtime, locate};
use crate::cloud::commands::Selection;
use crate::cloud::keys::fake::MemoryStore;
use crate::cloud::send::{Policy, Sender};
use crate::cloud::{CloudState, Keys, Step};

const GLYPHS: [(char, [u8; 7]); 28] = [
    (' ', [0, 0, 0, 0, 0, 0, 0]),
    ('.', [0, 0, 0, 0, 0, 12, 12]),
    ('A', [14, 17, 17, 31, 17, 17, 17]),
    ('B', [30, 17, 17, 30, 17, 17, 30]),
    ('C', [14, 17, 16, 16, 16, 17, 14]),
    ('D', [30, 17, 17, 17, 17, 17, 30]),
    ('E', [31, 16, 16, 30, 16, 16, 31]),
    ('F', [31, 16, 16, 30, 16, 16, 16]),
    ('G', [14, 17, 16, 23, 17, 17, 15]),
    ('H', [17, 17, 17, 31, 17, 17, 17]),
    ('I', [14, 4, 4, 4, 4, 4, 14]),
    ('J', [7, 2, 2, 2, 2, 18, 12]),
    ('K', [17, 18, 20, 24, 20, 18, 17]),
    ('L', [16, 16, 16, 16, 16, 16, 31]),
    ('M', [17, 27, 21, 21, 17, 17, 17]),
    ('N', [17, 17, 25, 21, 19, 17, 17]),
    ('O', [14, 17, 17, 17, 17, 17, 14]),
    ('P', [30, 17, 17, 30, 16, 16, 16]),
    ('Q', [14, 17, 17, 17, 21, 18, 13]),
    ('R', [30, 17, 17, 30, 20, 18, 17]),
    ('S', [15, 16, 16, 14, 1, 1, 30]),
    ('T', [31, 4, 4, 4, 4, 4, 4]),
    ('U', [17, 17, 17, 17, 17, 17, 14]),
    ('V', [17, 17, 17, 17, 17, 10, 4]),
    ('W', [17, 17, 17, 21, 21, 21, 10]),
    ('X', [17, 17, 10, 4, 10, 17, 17]),
    ('Y', [17, 17, 10, 4, 4, 4, 4]),
    ('Z', [31, 1, 2, 4, 8, 16, 31]),
];

const PAGE: [&str; 2] = ["HEUTE REGNET ES IN DER STADT.", "DER BUS KOMMT ZU SPAET."];
const SCALE: usize = 5;
const MARGIN: usize = 40;

fn render(lines: &[&str]) -> (usize, usize, Vec<u8>) {
    let columns = lines.iter().map(|line| line.len()).max().unwrap_or(0);
    let width = 2 * MARGIN + columns * 6 * SCALE;
    let height = 2 * MARGIN + lines.len() * 10 * SCALE;
    let mut pixels = vec![255u8; width * height];
    for (row, line) in lines.iter().enumerate() {
        for (column, letter) in line.chars().enumerate() {
            let glyph = GLYPHS
                .iter()
                .find(|(candidate, _)| *candidate == letter)
                .map(|(_, bits)| bits)
                .unwrap();
            for (y, bits) in glyph.iter().enumerate() {
                for x in 0..5 {
                    if bits & (16 >> x) == 0 {
                        continue;
                    }
                    for dy in 0..SCALE {
                        for dx in 0..SCALE {
                            let px = MARGIN + (column * 6 + x) * SCALE + dx;
                            let py = MARGIN + (row * 10 + y) * SCALE + dy;
                            pixels[py * width + px] = 0;
                        }
                    }
                }
            }
        }
    }
    (width, height, pixels)
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn chunk(png: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    png.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut body = kind.to_vec();
    body.extend_from_slice(data);
    png.extend_from_slice(&body);
    png.extend_from_slice(&crc32(&body).to_be_bytes());
}

fn png(width: usize, height: usize, pixels: &[u8]) -> Vec<u8> {
    let mut raw = Vec::new();
    for row in pixels.chunks(width) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (index, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(index + 1 == blocks.len()));
        let length = block.len() as u16;
        zlib.extend_from_slice(&length.to_le_bytes());
        zlib.extend_from_slice(&(!length).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for byte in &raw {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    zlib.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut header = Vec::new();
    header.extend_from_slice(&(width as u32).to_be_bytes());
    header.extend_from_slice(&(height as u32).to_be_bytes());
    header.extend_from_slice(&[8, 0, 0, 0, 0]);
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    chunk(&mut png, b"IHDR", &header);
    chunk(&mut png, b"IDAT", &zlib);
    chunk(&mut png, b"IEND", &[]);
    png
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for group in bytes.chunks(3) {
        let value = (u32::from(group[0]) << 16)
            | (u32::from(*group.get(1).unwrap_or(&0)) << 8)
            | u32::from(*group.get(2).unwrap_or(&0));
        for index in 0..4 {
            if index <= group.len() {
                out.push(TABLE[(value >> (18 - 6 * index) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn content(answer: &Value) -> String {
    answer["choices"][0]["message"]["content"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn the_rendered_page_is_a_valid_png() {
    let (width, height, pixels) = render(&PAGE);
    let bytes = png(width, height, &pixels);
    assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert_eq!(crc32(b"IEND"), 0xAE42_6082);
    assert_eq!(base64(b"Man"), "TWFu");
    assert_eq!(base64(b"Ma"), "TWE=");
}

#[tokio::test]
async fn real_claude_cli_reads_text_and_a_rendered_page() {
    if std::env::var("ROTSTIFT_CLI_SMOKE").as_deref() != Ok("1") {
        return;
    }
    let runtime = Runtime::default();
    let path = match std::env::var_os("ROTSTIFT_CLI_PATH") {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(locate::find(&runtime, &Claude).await.unwrap().path),
    };
    let model = std::env::var("ROTSTIFT_CLI_MODEL").unwrap_or_else(|_| "haiku".into());
    let dir = std::env::temp_dir().join(format!("rotstift-cli-smoke-{}", std::process::id()));
    let cloud = CloudState::with_sender(
        dir.clone(),
        Keys::with_store(Arc::new(MemoryStore::default())),
        Sender::new(Policy::default()),
    );
    let choose = |step: Step, protection: Option<bool>| {
        let cloud = &cloud;
        let path = path.to_string_lossy().into_owned();
        let model = model.clone();
        async move {
            cloud
                .use_choice(
                    step,
                    Selection {
                        template: "claude-code",
                        base_url: "cli://claude",
                        model: &model,
                        key: None,
                        cli_path: Some(&path),
                    },
                    true,
                    protection,
                    protection == Some(false),
                )
                .await
                .unwrap()
        }
    };
    let view = choose(Step::Corrector, None).await;
    println!("cli: {:?}", view.steps[&Step::Corrector].cli);

    let started = Instant::now();
    let answer = cloud
        .chat(
            None,
            Step::Corrector,
            json!({
                "messages": [
                    { "role": "system", "content": "Du korrigierst Rechtschreibung und Grammatik. Gib jede Zeile mit ihrer Nummer korrigiert zurück, sonst nichts." },
                    { "role": "user", "content": "1: Gestern bin ich mit mein Freund [Person 1] ins Kino gegangen.\n2: Der Film war sehr spanend." },
                ],
                "temperature": 0,
                "max_tokens": 400,
            }),
            true,
        )
        .await
        .unwrap();
    let corrected = content(&answer);
    println!("text: {} ms\n{corrected}", started.elapsed().as_millis());
    assert!(corrected.contains("spannend"));
    assert!(corrected.contains("[Person 1]"));

    choose(Step::Reviewer, None).await;
    let started = Instant::now();
    cloud.check(Step::Reviewer).await.unwrap();
    println!("schema check: {} ms", started.elapsed().as_millis());

    choose(Step::Transcriber, Some(false)).await;
    let (width, height, pixels) = render(&PAGE);
    let image = format!(
        "data:image/png;base64,{}",
        base64(&png(width, height, &pixels))
    );
    let started = Instant::now();
    let answer = cloud
        .chat(
            None,
            Step::Transcriber,
            json!({
                "messages": [{ "role": "user", "content": [
                    { "type": "image_url", "image_url": { "url": image } },
                    { "type": "text", "text": "Schreibe den Text auf dem Bild genau ab, Zeile für Zeile, ohne Kommentar." },
                ] }],
                "max_tokens": 400,
            }),
            false,
        )
        .await
        .unwrap();
    let transcript = content(&answer);
    println!(
        "image {width}x{height}: {} ms\n{transcript}",
        started.elapsed().as_millis()
    );
    let upper = transcript.to_uppercase();
    assert!(upper.contains("REGNET"));
    assert!(upper.contains("BUS"));
    let _ = std::fs::remove_dir_all(dir);
}
