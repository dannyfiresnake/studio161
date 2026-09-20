use libwing::{WingConsole, WingResponse};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// Messages from the client (WebSocket) to the Wing
#[derive(Deserialize)]
#[serde(tag = "cmd")]
pub enum ClientMsg {
    #[serde(rename = "set_float")]
    SetFloat { id: i32, value: f32 },
    #[serde(rename = "set_int")]
    SetInt { id: i32, value: i32 },
    #[serde(rename = "request_node_data")]
    RequestNodeData { id: i32 },
}

/// Messages from the Wing to the client (WebSocket)
#[derive(Serialize, Clone)]
#[serde(tag = "type")]
pub enum ServerMsg {
    #[serde(rename = "connected")]
    Connected,
    #[serde(rename = "disconnected")]
    Disconnected,
    #[serde(rename = "node_data_float")]
    NodeDataFloat { id: i32, value: f32 },
    #[serde(rename = "node_data_int")]
    NodeDataInt { id: i32, value: i32 },
    #[serde(rename = "node_data_string")]
    NodeDataString { id: i32, value: String },
}

/// Spawn a Wing connection bridge.
/// Returns channels for sending commands and receiving events.
pub fn spawn_bridge(
    host: Option<String>,
) -> (mpsc::UnboundedSender<ClientMsg>, mpsc::UnboundedReceiver<ServerMsg>) {
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<ClientMsg>();
    let (evt_tx, evt_rx) = mpsc::unbounded_channel::<ServerMsg>();

    tokio::task::spawn_blocking(move || {
        bridge_thread(host, cmd_rx, evt_tx);
    });

    (cmd_tx, evt_rx)
}

fn bridge_thread(
    host: Option<String>,
    mut cmd_rx: mpsc::UnboundedReceiver<ClientMsg>,
    evt_tx: mpsc::UnboundedSender<ServerMsg>,
) {
    let wing = match WingConsole::connect(host.as_deref()) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("Failed to connect to Wing: {}", e);
            let _ = evt_tx.send(ServerMsg::Disconnected);
            return;
        }
    };

    let _ = evt_tx.send(ServerMsg::Connected);

    // Spawn a writer thread that processes commands from the client
    let mut wing_writer = wing.clone();
    let writer_handle = std::thread::spawn(move || {
        while let Some(msg) = cmd_rx.blocking_recv() {
            let result = match msg {
                ClientMsg::SetFloat { id, value } => wing_writer.set_float(id, value),
                ClientMsg::SetInt { id, value } => wing_writer.set_int(id, value),
                ClientMsg::RequestNodeData { id } => wing_writer.request_node_data(id),
            };
            if let Err(e) = result {
                eprintln!("Wing write error: {}", e);
                break;
            }
        }
    });

    // Read loop on the main blocking thread
    let mut wing_reader = wing;
    loop {
        match wing_reader.read() {
            Ok(WingResponse::NodeData(id, data)) => {
                let msg = if data.has_float() {
                    ServerMsg::NodeDataFloat {
                        id,
                        value: data.get_float(),
                    }
                } else if data.has_string() {
                    ServerMsg::NodeDataString {
                        id,
                        value: data.get_string().to_string(),
                    }
                } else {
                    ServerMsg::NodeDataInt {
                        id,
                        value: data.get_int(),
                    }
                };
                if evt_tx.send(msg).is_err() {
                    break; // client disconnected
                }
            }
            Ok(WingResponse::NodeDef(_)) => {} // ignore schema responses
            Ok(WingResponse::RequestEnd) => {}  // ignore end markers
            Err(e) => {
                eprintln!("Wing read error: {}", e);
                let _ = evt_tx.send(ServerMsg::Disconnected);
                break;
            }
        }
    }

    let _ = writer_handle.join();
}
