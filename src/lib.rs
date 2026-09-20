mod bridge;
mod config;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use include_dir::{include_dir, Dir};
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;
use tower_http::services::ServeDir;

// The whole frontend (and the seed config.json) is embedded in the binary so
// the app is self-contained on platforms without a resource directory
// (Android). On desktop the on-disk static/ dir still wins when present.
static EMBEDDED_STATIC: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/static");

struct AppState {
    config: RwLock<config::ResolvedConfig>,
    raw_config: RwLock<serde_json::Value>,
    config_path: std::path::PathBuf,
    wing_host: Option<String>,
}

const PORT: u16 = 3161;

fn get_local_url() -> String {
    let ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());
    format!("http://{}:{}", ip, PORT)
}

/// The on-disk static dir (desktop): bundle Resources or ./static in dev.
fn get_static_dir() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().unwrap_or_default();
    let bundle_resource = exe
        .parent() // MacOS/
        .and_then(|p| p.parent()) // Contents/
        .map(|p| p.join("Resources").join("static"));
    if let Some(p) = bundle_resource {
        if p.exists() {
            return Some(p);
        }
    }
    let dev = std::path::PathBuf::from("static");
    if dev.join("config.json").exists() {
        return Some(dev);
    }
    None
}

fn load_state(config_path: std::path::PathBuf, wing_host: Option<String>) -> Arc<AppState> {
    // First run without an on-disk config: seed from the embedded copy.
    if !config_path.exists() {
        if let Some(parent) = config_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let seed = EMBEDDED_STATIC
            .get_file("config.json")
            .expect("embedded config.json missing")
            .contents();
        std::fs::write(&config_path, seed).expect("cannot seed config.json");
        println!("Seeded config at {}", config_path.display());
    }

    let raw_config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&config_path)
            .unwrap_or_else(|_| panic!("Cannot read {}", config_path.display())),
    )
    .expect("Invalid config.json");

    let resolved = config::resolve_config(&raw_config);
    println!(
        "Config resolved: {} outputs, {} inputs, {} fx, {} sources",
        resolved.outputs.len(),
        resolved.inputs.len(),
        resolved.fx.len(),
        resolved.sources.len() + resolved.fx_sources.len() + resolved.output_fx_sources.len(),
    );

    Arc::new(AppState {
        config: RwLock::new(resolved),
        raw_config: RwLock::new(raw_config),
        config_path,
        wing_host,
    })
}

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "json" | "webmanifest" => "application/json",
        _ => "application/octet-stream",
    }
}

async fn embedded_file(uri: axum::http::Uri) -> axum::response::Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match EMBEDDED_STATIC.get_file(path) {
        Some(f) => (
            [(axum::http::header::CONTENT_TYPE, mime_for(path))],
            f.contents(),
        )
            .into_response(),
        None => (axum::http::StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

/// Bind the port synchronously (so the webview can't race the server), then
/// serve on the Tauri-managed tokio runtime.
fn start_server(state: Arc<AppState>, static_dir: Option<std::path::PathBuf>) {
    let std_listener =
        std::net::TcpListener::bind(("0.0.0.0", PORT)).expect("cannot bind port 3161");
    std_listener
        .set_nonblocking(true)
        .expect("cannot set nonblocking");

    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/api/config", get(get_config))
            .route("/api/config/raw", get(get_raw_config))
            .route("/api/config/raw", post(save_raw_config))
            .route("/ws", get(ws_upgrade));
        let router = match static_dir {
            Some(dir) => router.fallback_service(ServeDir::new(dir)),
            None => router.fallback(embedded_file),
        };
        // Assets have fixed names (app.js/app.css), so force revalidation —
        // otherwise webviews cache stale UI across app updates.
        let app = router.with_state(state).layer(
            tower_http::set_header::SetResponseHeaderLayer::overriding(
                axum::http::header::CACHE_CONTROL,
                axum::http::HeaderValue::from_static("no-cache"),
            ),
        );

        println!("HTTP server listening on 0.0.0.0:{}", PORT);
        println!("Access from other devices: {}", get_local_url());
        let listener = tokio::net::TcpListener::from_std(std_listener).unwrap();
        axum::serve(listener, app).await.unwrap();
    });
}

#[cfg(desktop)]
fn setup_tray(app: &mut tauri::App, url: String) -> tauri::Result<()> {
    use tauri::{
        menu::{MenuBuilder, MenuItemBuilder},
        tray::TrayIconBuilder,
    };

    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Regular);

    let show_ui = MenuItemBuilder::with_id("show", "Show UI").build(app)?;
    let url_item = MenuItemBuilder::with_id("url", format!("Copy URL: {}", url)).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&url_item)
        .separator()
        .item(&show_ui)
        .separator()
        .item(&quit)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .icon_as_template(true)
        .tooltip(&format!("Studio161 — {}", url))
        .menu(&menu)
        .on_menu_event({
            let url_copy = url.clone();
            move |app, event| match event.id().as_ref() {
                "url" => {
                    use std::process::Command;
                    let mut child = Command::new("pbcopy")
                        .stdin(std::process::Stdio::piped())
                        .spawn()
                        .expect("pbcopy failed");
                    if let Some(stdin) = child.stdin.as_mut() {
                        use std::io::Write;
                        let _ = write!(stdin, "{}", url_copy);
                    }
                    let _ = child.wait();
                }
                "show" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let wing_host = std::env::args().nth(1).filter(|a| !a.starts_with('-'));
    if let Some(ref h) = wing_host {
        println!("Wing host: {}", h);
    } else {
        println!("No host specified, will auto-discover Wing on network");
    }

    let builder = tauri::Builder::default().setup(move |app| {
        let static_dir = get_static_dir();
        let config_path = match &static_dir {
            Some(dir) => dir.join("config.json"),
            None => app.path().app_data_dir()?.join("config.json"),
        };
        let state = load_state(config_path, wing_host.clone());
        start_server(state, static_dir);

        // The window is created here, after the server socket is bound, so
        // the webview's first load can never hit a connection-refused race.
        let url: tauri::Url = format!("http://localhost:{}", PORT).parse().unwrap();
        let win_builder =
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url));
        #[cfg(desktop)]
        let win_builder = win_builder
            .title("Studio161")
            .inner_size(1200.0, 900.0)
            .min_inner_size(600.0, 500.0);
        // Wayland compositors advertise no server-side decorations, so GTK
        // draws its own titlebar: a strip of min/max/close buttons that just
        // duplicates what the window manager already does. Drop it. Not done
        // on macOS, where the titlebar is the only drag handle and carries
        // the traffic lights.
        #[cfg(target_os = "linux")]
        let win_builder = win_builder.decorations(false);
        let window = win_builder.build()?;

        // WebKitGTK shows its own native context menu (Reload / Go Back /
        // Inspect) on right-click, and preventDefault() on the DOM event does
        // not stop it. Returning true from the signal suppresses the menu.
        #[cfg(target_os = "linux")]
        {
            use webkit2gtk::WebViewExt;
            window.with_webview(|webview| {
                webview.inner().connect_context_menu(|_, _, _, _| true);
            })?;
        }

        #[cfg(desktop)]
        setup_tray(app, get_local_url())?;

        Ok(())
    });

    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
            // Keep dock icon visible so clicking it can reopen
        }
    });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(win) = _app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        });
}

async fn get_config(State(state): State<Arc<AppState>>) -> Json<config::ResolvedConfig> {
    Json(state.config.read().await.clone())
}

async fn get_raw_config(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(state.raw_config.read().await.clone())
}

async fn save_raw_config(
    State(state): State<Arc<AppState>>,
    Json(new_config): Json<serde_json::Value>,
) -> axum::response::Result<Json<serde_json::Value>> {
    let json = serde_json::to_string_pretty(&new_config)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    std::fs::write(&state.config_path, &json)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    let resolved = config::resolve_config(&new_config);
    *state.config.write().await = resolved;
    *state.raw_config.write().await = new_config;
    Ok(Json(serde_json::json!({"ok": true})))
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> axum::response::Response {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    println!("WebSocket client connected");

    let (cmd_tx, mut evt_rx) = bridge::spawn_bridge(state.wing_host.clone());

    loop {
        tokio::select! {
            evt = evt_rx.recv() => {
                match evt {
                    Some(msg) => {
                        let json = serde_json::to_string(&msg).unwrap();
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    None => {
                        let disc = serde_json::to_string(&bridge::ServerMsg::Disconnected).unwrap();
                        let _ = socket.send(Message::Text(disc.into())).await;
                        break;
                    }
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<bridge::ClientMsg>(&text) {
                            Ok(cmd) => {
                                if cmd_tx.send(cmd).is_err() {
                                    break;
                                }
                            }
                            Err(e) => {
                                eprintln!("Bad client message: {}", e);
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    println!("WebSocket client disconnected");
}
