// Desktop entry point; all app logic lives in the library so the same code
// serves the mobile entry point (see src/lib.rs).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMABUF renderer trips over the NVIDIA driver under Wayland
    // and kills the process with "Error 71 (Protocol error) dispatching to
    // Wayland display" as soon as the window is realized. Must be set before
    // GTK is initialized. Respect an explicit value if one is already set.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    studio161_lib::run()
}
