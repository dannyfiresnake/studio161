use libwing::WingConsole;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ResolvedConfig {
    pub outputs: Vec<ResolvedOutput>,
    pub inputs: Vec<ResolvedInput>,
    pub fx: Vec<ResolvedFx>,
    /// input-to-output routing sources
    pub sources: Vec<ResolvedInputSource>,
    /// input-to-fx routing sources
    pub fx_sources: Vec<ResolvedInputSource>,
    /// fx-to-output routing sources (fx return into an output bus)
    pub output_fx_sources: Vec<ResolvedFxSource>,
}

#[derive(Serialize, Clone)]
pub struct ResolvedOutput {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_scale: Option<f64>,
    pub wing_prop_level: i32,
    pub wing_prop_mute: i32,
}

#[derive(Serialize, Clone)]
pub struct ResolvedInput {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_scale: Option<f64>,
    pub channel: i32,
}

#[derive(Serialize, Clone)]
pub struct ResolvedFx {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_scale: Option<f64>,
    pub bus: String,
}

#[derive(Serialize, Clone)]
pub struct ResolvedInputSource {
    pub input_id: String,
    pub output_id: String,
    pub wing_prop_send: i32,
    pub wing_prop_level: i32,
}

#[derive(Serialize, Clone)]
pub struct ResolvedFxSource {
    pub fx_id: String,
    pub output_id: String,
    pub wing_prop_send: i32,
}

fn name_to_id(path: &str) -> i32 {
    WingConsole::name_to_id(path).unwrap_or_else(|| panic!("Unknown Wing property: {}", path))
}

pub fn resolve_config(raw: &serde_json::Value) -> ResolvedConfig {
    let mut outputs = Vec::new();
    let mut inputs = Vec::new();
    let mut fx = Vec::new();
    let mut sources = Vec::new();
    let mut fx_sources = Vec::new();
    let mut output_fx_sources = Vec::new();

    // Parse outputs, computing outputSof and wing prop IDs
    struct OutputInfo {
        id: String,
        output_sof: String,
    }
    let mut output_infos = Vec::new();

    for o in raw["outputs"].as_array().unwrap() {
        let id = o["id"].as_str().unwrap().to_string();
        let (wing_prop_level, wing_prop_mute, output_sof) = if let Some(bus) = o.get("bus") {
            let b = bus.as_i64().unwrap();
            (
                name_to_id(&format!("/bus/{}/fdr", b)),
                name_to_id(&format!("/bus/{}/mute", b)),
                format!("send/{}", b),
            )
        } else if let Some(main) = o.get("main") {
            let m = main.as_i64().unwrap();
            (
                name_to_id(&format!("/main/{}/fdr", m)),
                name_to_id(&format!("/main/{}/mute", m)),
                format!("main/{}", m),
            )
        } else {
            panic!("Output {} must have 'bus' or 'main'", id);
        };

        outputs.push(ResolvedOutput {
            id: id.clone(),
            name: o["name"].as_str().unwrap().to_string(),
            color: o["color"].as_str().unwrap().to_string(),
            icon: o["icon"].as_str().unwrap().to_string(),
            icon_scale: o.get("iconScale").and_then(|v| v.as_f64()),
            wing_prop_level,
            wing_prop_mute,
        });
        output_infos.push(OutputInfo {
            id: id.clone(),
            output_sof,
        });
    }

    // Parse FX
    struct FxInfo {
        id: String,
        bus: String,
        output_sof: String,
    }
    let mut fx_infos = Vec::new();

    for f in raw["fx"].as_array().unwrap() {
        let id = f["id"].as_str().unwrap().to_string();
        let bus_num = f["bus"].as_i64().unwrap();
        let bus = format!("bus/{}", bus_num);
        let output_sof = format!("send/{}", bus_num);

        fx.push(ResolvedFx {
            id: id.clone(),
            name: f["name"].as_str().unwrap().to_string(),
            color: f["color"].as_str().unwrap().to_string(),
            icon: f["icon"].as_str().unwrap().to_string(),
            icon_scale: f.get("iconScale").and_then(|v| v.as_f64()),
            bus: bus.clone(),
        });
        fx_infos.push(FxInfo {
            id: id.clone(),
            bus,
            output_sof,
        });
    }

    // Parse inputs
    for i in raw["inputs"].as_array().unwrap() {
        let id = i["id"].as_str().unwrap().to_string();
        let channel = i["channel"].as_i64().unwrap() as i32;

        inputs.push(ResolvedInput {
            id: id.clone(),
            name: i["name"].as_str().unwrap().to_string(),
            color: i["color"].as_str().unwrap().to_string(),
            icon: i["icon"].as_str().unwrap().to_string(),
            icon_scale: i.get("iconScale").and_then(|v| v.as_f64()),
            channel,
        });

        // Wire input → each output
        for oi in &output_infos {
            sources.push(ResolvedInputSource {
                input_id: id.clone(),
                output_id: oi.id.clone(),
                wing_prop_send: name_to_id(&format!("/ch/{}/{}/on", channel, oi.output_sof)),
                wing_prop_level: name_to_id(&format!("/ch/{}/{}/lvl", channel, oi.output_sof)),
            });
        }

        // Wire input → each FX
        for fi in &fx_infos {
            fx_sources.push(ResolvedInputSource {
                input_id: id.clone(),
                output_id: fi.id.clone(),
                wing_prop_send: name_to_id(&format!("/ch/{}/{}/on", channel, fi.output_sof)),
                wing_prop_level: name_to_id(&format!("/ch/{}/{}/lvl", channel, fi.output_sof)),
            });
        }
    }

    // Wire FX → each output (fx return sends)
    for fi in &fx_infos {
        for oi in &output_infos {
            output_fx_sources.push(ResolvedFxSource {
                fx_id: fi.id.clone(),
                output_id: oi.id.clone(),
                wing_prop_send: name_to_id(&format!("/{}/{}/on", fi.bus, oi.output_sof)),
            });
        }
    }

    ResolvedConfig {
        outputs,
        inputs,
        fx,
        sources,
        fx_sources,
        output_fx_sources,
    }
}
