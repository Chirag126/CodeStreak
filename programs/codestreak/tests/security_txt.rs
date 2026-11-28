//! Phase 47: the deployed binary carries a security.txt that explorers and `query-security-txt` read.
//! Build the program first, then run:  anchor build && cargo test -p codestreak --test security_txt
const PROGRAM_SO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/codestreak.so");
const BEGIN: &[u8] = b"=======BEGIN SECURITY.TXT V1=======\0";
const END: &[u8] = b"=======END SECURITY.TXT V1=======\0";

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[test]
fn binary_contains_a_well_formed_security_txt() {
    let so = std::fs::read(PROGRAM_SO).expect("target/deploy/codestreak.so not found: run `anchor build` first");
    let start = find(&so, BEGIN).expect("no security.txt in the binary") + BEGIN.len();
    let len = find(&so[start..], END).expect("security.txt is not terminated");
    let fields: Vec<&str> = so[start..start + len].split(|b| *b == 0).filter(|f| !f.is_empty()).map(|f| std::str::from_utf8(f).unwrap()).collect();
    assert_eq!(fields.len() % 2, 0, "key/value pairs: {fields:?}");
    let get = |key: &str| fields.chunks(2).find(|kv| kv[0] == key).map(|kv| kv[1]);
    // The fields a researcher needs (the format's required ones) are all there.
    assert_eq!(get("name"), Some("CodeStreak"));
    assert_eq!(get("project_url"), Some("https://github.com/Chirag126/CodeStreak"));
    assert!(get("contacts").is_some_and(|c| c.starts_with("link:https://")));
    assert!(get("policy").is_some_and(|p| p.ends_with("SECURITY.md")));
    assert_eq!(get("source_code"), Some("https://github.com/Chirag126/CodeStreak"));
    println!("security.txt: {fields:?}");
}
