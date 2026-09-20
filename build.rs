fn main() {
    // static/ is embedded into the binary (include_dir in src/lib.rs), and
    // include_dir does not register the files with cargo on stable — without
    // this, UI-only changes would ship stale embedded assets.
    println!("cargo:rerun-if-changed=static");
    tauri_build::build();
}
