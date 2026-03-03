use crate::utils::{platform, shell};
use serde::{Deserialize, Serialize};
use tauri::command;
use log::{info, warn, error, debug};
use std::time::Instant;

const DEFAULT_NPM_REGISTRY: &str = "https://registry.npmjs.org/";
const STABLE_NPM_REGISTRY: &str = "https://registry.npmmirror.com/";

/// 环境检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentStatus {
    /// Node.js 是否安装
    pub node_installed: bool,
    /// Node.js 版本
    pub node_version: Option<String>,
    /// Node.js 版本是否满足要求 (>=22)
    pub node_version_ok: bool,
    /// OpenClaw 是否安装
    pub openclaw_installed: bool,
    /// OpenClaw 版本
    pub openclaw_version: Option<String>,
    /// 配置目录是否存在
    pub config_dir_exists: bool,
    /// 是否全部就绪
    pub ready: bool,
    /// 操作系统
    pub os: String,
}

/// 安装进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub step: String,
    pub progress: u8,
    pub message: String,
    pub error: Option<String>,
}

/// 安装结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub success: bool,
    pub message: String,
    pub error: Option<String>,
}

/// npm 网络检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NpmNetworkStatus {
    pub healthy: bool,
    pub latency_ms: Option<u128>,
    pub current_registry: Option<String>,
    pub recommended_registry: Option<String>,
    pub message: String,
}

/// 临时源切换状态
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegistryState {
    original_registry: String,
    temporary_registry: String,
    active: bool,
}

/// 诊断导出参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticRequest {
    pub stage: String,
    pub error: Option<String>,
    pub code: Option<String>,
    pub context: Option<Vec<String>>,
    pub logs: Vec<String>,
}

/// 修复动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryAction {
    pub id: String,
    pub label: String,
    pub description: String,
    pub recommended: bool,
}

/// 安装失败分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallFailureAnalysis {
    pub code: String,
    pub title: String,
    pub reason: String,
    pub impact: String,
    pub next_step: String,
    pub retryable: bool,
    pub actions: Vec<RecoveryAction>,
}

fn collect_environment_status() -> EnvironmentStatus {
    let os = platform::get_os();
    let node_version = get_node_version();
    let node_installed = node_version.is_some();
    let node_version_ok = check_node_version_requirement(&node_version);
    let openclaw_version = get_openclaw_version();
    let openclaw_installed = openclaw_version.is_some();
    let config_dir = platform::get_config_dir();
    let config_dir_exists = std::path::Path::new(&config_dir).exists();
    let ready = node_installed && node_version_ok && openclaw_installed;

    EnvironmentStatus {
        node_installed,
        node_version,
        node_version_ok,
        openclaw_installed,
        openclaw_version,
        config_dir_exists,
        ready,
        os,
    }
}

/// 检查环境状态
#[command]
pub async fn check_environment() -> Result<EnvironmentStatus, String> {
    info!("[环境检查] 开始检查系统环境...");

    let status = collect_environment_status();
    info!("[环境检查] 操作系统: {}", status.os);
    info!(
        "[环境检查] Node.js: installed={}, version={:?}, version_ok={}",
        status.node_installed, status.node_version, status.node_version_ok
    );
    info!(
        "[环境检查] OpenClaw: installed={}, version={:?}",
        status.openclaw_installed, status.openclaw_version
    );
    info!("[环境检查] 环境就绪状态: ready={}", status.ready);

    Ok(status)
}

fn get_registry_state_path() -> String {
    if platform::is_windows() {
        format!("{}\\installer_registry_state.json", platform::get_config_dir())
    } else {
        format!("{}/installer_registry_state.json", platform::get_config_dir())
    }
}

fn normalize_registry(registry: &str) -> String {
    let trimmed = registry.trim();
    if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{}/", trimmed)
    }
}

fn get_npm_registry() -> Option<String> {
    let output = if platform::is_windows() {
        shell::run_cmd_output("npm config get registry")
    } else {
        shell::run_bash_output("npm config get registry 2>/dev/null")
    };

    output.ok().and_then(|value| {
        let v = value.trim().to_string();
        if v.is_empty() || v == "undefined" {
            None
        } else {
            Some(normalize_registry(&v))
        }
    })
}

fn set_npm_registry(registry: &str) -> Result<(), String> {
    let registry = normalize_registry(registry);
    let cmd = format!("npm config set registry {}", registry);
    if platform::is_windows() {
        shell::run_cmd_output(&cmd).map(|_| ())
    } else {
        shell::run_bash_output(&cmd).map(|_| ())
    }
}

fn load_registry_state() -> Option<RegistryState> {
    let state_path = get_registry_state_path();
    std::fs::read_to_string(&state_path)
        .ok()
        .and_then(|content| serde_json::from_str::<RegistryState>(&content).ok())
}

fn save_registry_state(state: &RegistryState) -> Result<(), String> {
    let state_path = get_registry_state_path();
    std::fs::create_dir_all(platform::get_config_dir())
        .map_err(|e| format!("创建配置目录失败: {}", e))?;
    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("序列化状态失败: {}", e))?;
    std::fs::write(&state_path, content)
        .map_err(|e| format!("写入状态失败: {}", e))
}

fn clear_registry_state() {
    let state_path = get_registry_state_path();
    let _ = std::fs::remove_file(state_path);
}

fn detect_error_code(stage: &str, raw_error: &str) -> String {
    let stage = stage.to_lowercase();
    let e = raw_error.to_lowercase();

    if e.contains("econnreset")
        || e.contains("etimedout")
        || e.contains("timed out")
        || e.contains("enotfound")
        || e.contains("network")
        || e.contains("registry")
        || e.contains("proxy")
    {
        return "NETWORK_UNSTABLE".to_string();
    }

    if e.contains("eacces")
        || e.contains("eperm")
        || e.contains("access denied")
        || e.contains("permission")
        || e.contains("权限")
        || e.contains("管理员")
    {
        return "PERMISSION_DENIED".to_string();
    }

    if e.contains("not recognized")
        || e.contains("command not found")
        || e.contains("未找到")
        || e.contains("path")
    {
        return "PATH_NOT_READY".to_string();
    }

    if stage == "node" && (e.contains("v22") || e.contains("node")) {
        return "NODE_VERSION_INVALID".to_string();
    }

    if stage == "openclaw" && (e.contains("openclaw") || e.contains("npm")) {
        return "OPENCLAW_INSTALL_FAILED".to_string();
    }

    if stage == "init" && e.contains("config") {
        return "CONFIG_INIT_FAILED".to_string();
    }

    "UNKNOWN".to_string()
}

fn build_actions(code: &str) -> Vec<RecoveryAction> {
    match code {
        "NETWORK_UNSTABLE" => vec![
            RecoveryAction {
                id: "retry-install".to_string(),
                label: "执行推荐修复".to_string(),
                description: "自动切换稳定线路并重试当前步骤。".to_string(),
                recommended: true,
            },
            RecoveryAction {
                id: "admin-retry".to_string(),
                label: "管理员重试".to_string(),
                description: "以更高权限重试安装流程。".to_string(),
                recommended: false,
            },
        ],
        "PERMISSION_DENIED" => vec![
            RecoveryAction {
                id: "admin-retry".to_string(),
                label: "管理员权限重试".to_string(),
                description: "使用管理员权限重新执行失败步骤。".to_string(),
                recommended: true,
            },
            RecoveryAction {
                id: "retry-install".to_string(),
                label: "直接重试".to_string(),
                description: "保持当前权限再次尝试。".to_string(),
                recommended: false,
            },
        ],
        "PATH_NOT_READY" => vec![
            RecoveryAction {
                id: "recheck".to_string(),
                label: "重新检测".to_string(),
                description: "重新检测环境变量是否生效。".to_string(),
                recommended: true,
            },
            RecoveryAction {
                id: "retry-install".to_string(),
                label: "继续安装".to_string(),
                description: "从当前步骤继续重试。".to_string(),
                recommended: false,
            },
        ],
        "NODE_VERSION_INVALID" => vec![
            RecoveryAction {
                id: "retry-install".to_string(),
                label: "自动安装 Node.js（推荐）".to_string(),
                description: "重新执行自动安装流程并继续安装 OpenClaw。".to_string(),
                recommended: true,
            },
            RecoveryAction {
                id: "node-terminal".to_string(),
                label: "手动安装 Node.js".to_string(),
                description: "自动安装失败时，打开引导终端进行手动安装。".to_string(),
                recommended: false,
            },
        ],
        "OPENCLAW_INSTALL_FAILED" => vec![
            RecoveryAction {
                id: "retry-install".to_string(),
                label: "重试 OpenClaw 安装".to_string(),
                description: "保持当前配置重新安装 OpenClaw。".to_string(),
                recommended: true,
            },
            RecoveryAction {
                id: "openclaw-terminal".to_string(),
                label: "打开手动安装终端".to_string(),
                description: "在新终端按提示手动安装 OpenClaw。".to_string(),
                recommended: false,
            },
        ],
        _ => vec![
            RecoveryAction {
                id: "retry-install".to_string(),
                label: "重试当前步骤".to_string(),
                description: "使用当前参数重新执行。".to_string(),
                recommended: true,
            },
            RecoveryAction {
                id: "recheck".to_string(),
                label: "重新检测环境".to_string(),
                description: "重新收集环境状态后再继续。".to_string(),
                recommended: false,
            },
        ],
    }
}

/// 分析安装失败并给出修复建议
#[command]
pub async fn analyze_install_failure(stage: String, error: String) -> Result<InstallFailureAnalysis, String> {
    let code = detect_error_code(&stage, &error);
    let actions = build_actions(&code);

    let (title, reason, impact, next_step, retryable) = match code.as_str() {
        "NETWORK_UNSTABLE" => (
            "网络连接不稳定",
            "当前网络无法稳定下载安装包。",
            "安装包下载可能中断，导致当前步骤失败。",
            "建议先执行推荐修复，自动切换稳定线路后重试。",
            true,
        ),
        "PERMISSION_DENIED" => (
            "权限不足",
            "系统拒绝了当前安装操作。",
            "系统拒绝了安装或配置写入操作。",
            "建议使用管理员权限重试。",
            true,
        ),
        "PATH_NOT_READY" => (
            "环境变量尚未生效",
            "安装完成后系统路径还没刷新。",
            "系统暂时无法识别新安装命令。",
            "请先重新检测；如仍失败，重启应用后再试。",
            true,
        ),
        "NODE_VERSION_INVALID" => (
            "Node.js 未就绪",
            "未检测到可用的 Node.js 22+ 环境。",
            "OpenClaw 依赖 Node.js 22 及以上版本。",
            "请先执行推荐修复进行自动安装；若失败再手动安装。",
            true,
        ),
        "OPENCLAW_INSTALL_FAILED" => (
            "OpenClaw 安装失败",
            "OpenClaw 安装过程未成功完成。",
            "当前无法进入后续配置和服务管理。",
            "先重试安装；若多次失败可切换手动安装。",
            true,
        ),
        "CONFIG_INIT_FAILED" => (
            "配置初始化失败",
            "安装后的配置目录初始化未完成。",
            "OpenClaw 可能无法正常启动。",
            "建议从当前步骤重试，必要时导出诊断信息。",
            true,
        ),
        _ => (
            "出现未知错误",
            "安装过程中出现未识别的异常。",
            "安装流程未完成，无法保证环境可用。",
            "请先重试当前步骤，若仍失败请导出诊断报告。",
            true,
        ),
    };

    Ok(InstallFailureAnalysis {
        code,
        title: title.to_string(),
        reason: reason.to_string(),
        impact: impact.to_string(),
        next_step: next_step.to_string(),
        retryable,
        actions,
    })
}

/// 预检 npm 下载线路
#[command]
pub async fn precheck_npm_registry() -> Result<NpmNetworkStatus, String> {
    info!("[网络预检] 开始检查 npm 下载线路...");

    let current_registry = get_npm_registry().or_else(|| Some(DEFAULT_NPM_REGISTRY.to_string()));
    let start = Instant::now();
    let check_result = if platform::is_windows() {
        shell::run_cmd_output("npm view openclaw version")
    } else {
        shell::run_bash_output("npm view openclaw version 2>/dev/null")
    };
    let elapsed = start.elapsed().as_millis();

    match check_result {
        Ok(_) => {
            let healthy = elapsed < 4500;
            let message = if healthy {
                format!("下载线路可用（{} ms）", elapsed)
            } else {
                format!("下载线路较慢（{} ms），建议切换稳定线路", elapsed)
            };

            Ok(NpmNetworkStatus {
                healthy,
                latency_ms: Some(elapsed),
                current_registry,
                recommended_registry: if healthy {
                    None
                } else {
                    Some(STABLE_NPM_REGISTRY.to_string())
                },
                message,
            })
        }
        Err(e) => {
            warn!("[网络预检] npm 下载线路检查失败: {}", e);
            Ok(NpmNetworkStatus {
                healthy: false,
                latency_ms: None,
                current_registry,
                recommended_registry: Some(STABLE_NPM_REGISTRY.to_string()),
                message: "当前下载线路不可用，建议切换稳定线路后重试。".to_string(),
            })
        }
    }
}

/// 临时切换 npm 下载线路
#[command]
pub async fn use_temporary_npm_registry(registry: Option<String>) -> Result<InstallResult, String> {
    let target_registry = normalize_registry(registry.as_deref().unwrap_or(STABLE_NPM_REGISTRY));
    let current_registry = get_npm_registry().unwrap_or_else(|| DEFAULT_NPM_REGISTRY.to_string());

    if let Some(state) = load_registry_state() {
        if state.active {
            info!("[网络预检] 临时线路已开启: {}", state.temporary_registry);
            return Ok(InstallResult {
                success: true,
                message: "稳定线路已启用。".to_string(),
                error: None,
            });
        }
    }

    if normalize_registry(&current_registry) == target_registry {
        return Ok(InstallResult {
            success: true,
            message: "当前已经是稳定线路，无需切换。".to_string(),
            error: None,
        });
    }

    set_npm_registry(&target_registry)?;
    save_registry_state(&RegistryState {
        original_registry: current_registry,
        temporary_registry: target_registry,
        active: true,
    })?;

    Ok(InstallResult {
        success: true,
        message: "已切换到稳定下载线路，安装完成后会自动恢复。".to_string(),
        error: None,
    })
}

/// 恢复 npm 下载线路
#[command]
pub async fn restore_npm_registry() -> Result<InstallResult, String> {
    let state = load_registry_state();
    if state.is_none() {
        return Ok(InstallResult {
            success: true,
            message: "未检测到临时线路，无需恢复。".to_string(),
            error: None,
        });
    }

    let state = state.unwrap();
    if !state.active {
        clear_registry_state();
        return Ok(InstallResult {
            success: true,
            message: "下载线路已是默认状态。".to_string(),
            error: None,
        });
    }

    match set_npm_registry(&state.original_registry) {
        Ok(_) => {
            clear_registry_state();
            Ok(InstallResult {
                success: true,
                message: "已恢复到原始下载线路。".to_string(),
                error: None,
            })
        }
        Err(e) => Ok(InstallResult {
            success: false,
            message: "安装已完成，但下载线路恢复失败。".to_string(),
            error: Some(e),
        }),
    }
}

/// 导出安装诊断报告
#[command]
pub async fn export_install_diagnostic_report(req: DiagnosticRequest) -> Result<String, String> {
    let status = collect_environment_status();
    let diagnostics_dir = if platform::is_windows() {
        format!("{}\\diagnostics", platform::get_config_dir())
    } else {
        format!("{}/diagnostics", platform::get_config_dir())
    };

    std::fs::create_dir_all(&diagnostics_dir)
        .map_err(|e| format!("创建诊断目录失败: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let report_path = if platform::is_windows() {
        format!("{}\\install_report_{}.txt", diagnostics_dir, timestamp)
    } else {
        format!("{}/install_report_{}.txt", diagnostics_dir, timestamp)
    };

    let mut lines = vec![
        "OpenClaw Manager 安装诊断报告".to_string(),
        format!("时间: {}", chrono::Local::now().to_rfc3339()),
        format!("阶段: {}", req.stage),
        format!("错误码: {}", req.code.clone().unwrap_or_else(|| "UNKNOWN".to_string())),
        format!("错误: {}", req.error.clone().unwrap_or_else(|| "无".to_string())),
        "".to_string(),
        "[环境信息]".to_string(),
        format!("操作系统: {}", status.os),
        format!("Node.js: {}", status.node_version.unwrap_or_else(|| "未安装".to_string())),
        format!("Node 版本满足要求: {}", status.node_version_ok),
        format!("OpenClaw: {}", status.openclaw_version.unwrap_or_else(|| "未安装".to_string())),
        format!("配置目录存在: {}", status.config_dir_exists),
        format!("环境就绪: {}", status.ready),
        "".to_string(),
        "[npm 下载线路]".to_string(),
        format!("当前 registry: {}", get_npm_registry().unwrap_or_else(|| "未知".to_string())),
        "".to_string(),
        "[上下文信息]".to_string(),
    ];

    if let Some(context_lines) = req.context.clone() {
        lines.extend(context_lines);
    } else {
        lines.push("无".to_string());
    }

    lines.extend(vec![
        "".to_string(),
        "[安装日志]".to_string(),
    ]);
    lines.extend(req.logs.clone());

    std::fs::write(&report_path, lines.join("\n"))
        .map_err(|e| format!("写入诊断报告失败: {}", e))?;

    Ok(report_path)
}

/// 获取 Node.js 版本
/// 检测多个可能的安装路径，因为 GUI 应用不继承用户 shell 的 PATH
fn get_node_version() -> Option<String> {
    if platform::is_windows() {
        // Windows: 先尝试直接调用（如果 PATH 已更新）
        if let Ok(v) = shell::run_cmd_output("node --version") {
            let version = v.trim().to_string();
            if !version.is_empty() && version.starts_with('v') {
                info!("[环境检查] 通过 PATH 找到 Node.js: {}", version);
                return Some(version);
            }
        }
        
        // Windows: 检查常见的安装路径
        let possible_paths = get_windows_node_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                // 使用完整路径执行
                let cmd = format!("\"{}\" --version", path);
                if let Ok(output) = shell::run_cmd_output(&cmd) {
                    let version = output.trim().to_string();
                    if !version.is_empty() && version.starts_with('v') {
                        info!("[环境检查] 在 {} 找到 Node.js: {}", path, version);
                        return Some(version);
                    }
                }
            }
        }
        
        None
    } else {
        // 先尝试直接调用
        if let Ok(v) = shell::run_command_output("node", &["--version"]) {
            return Some(v.trim().to_string());
        }
        
        // 检测常见的 Node.js 安装路径（macOS/Linux）
        let possible_paths = get_unix_node_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                if let Ok(output) = shell::run_command_output(&path, &["--version"]) {
                    info!("[环境检查] 在 {} 找到 Node.js: {}", path, output.trim());
                    return Some(output.trim().to_string());
                }
            }
        }
        
        // 尝试通过 shell 加载用户环境来检测
        if let Ok(output) = shell::run_bash_output("source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null; node --version 2>/dev/null") {
            if !output.is_empty() && output.starts_with('v') {
                info!("[环境检查] 通过用户 shell 找到 Node.js: {}", output.trim());
                return Some(output.trim().to_string());
            }
        }
        
        None
    }
}

/// 获取 Unix 系统上可能的 Node.js 路径
fn get_unix_node_paths() -> Vec<String> {
    let mut paths = Vec::new();
    
    // Homebrew (macOS)
    paths.push("/opt/homebrew/bin/node".to_string()); // Apple Silicon
    paths.push("/usr/local/bin/node".to_string());     // Intel Mac
    
    // 系统安装
    paths.push("/usr/bin/node".to_string());
    
    // nvm (检查常见版本)
    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();
        
        // nvm 默认版本
        paths.push(format!("{}/.nvm/versions/node/v22.0.0/bin/node", home_str));
        paths.push(format!("{}/.nvm/versions/node/v22.1.0/bin/node", home_str));
        paths.push(format!("{}/.nvm/versions/node/v22.2.0/bin/node", home_str));
        paths.push(format!("{}/.nvm/versions/node/v22.11.0/bin/node", home_str));
        paths.push(format!("{}/.nvm/versions/node/v22.12.0/bin/node", home_str));
        paths.push(format!("{}/.nvm/versions/node/v23.0.0/bin/node", home_str));
        
        // 尝试 nvm alias default（读取 nvm 的 default alias）
        let nvm_default = format!("{}/.nvm/alias/default", home_str);
        if let Ok(version) = std::fs::read_to_string(&nvm_default) {
            let version = version.trim();
            if !version.is_empty() {
                paths.insert(0, format!("{}/.nvm/versions/node/v{}/bin/node", home_str, version));
            }
        }
        
        // fnm
        paths.push(format!("{}/.fnm/aliases/default/bin/node", home_str));
        
        // volta
        paths.push(format!("{}/.volta/bin/node", home_str));
        
        // asdf
        paths.push(format!("{}/.asdf/shims/node", home_str));
        
        // mise (formerly rtx)
        paths.push(format!("{}/.local/share/mise/shims/node", home_str));
    }
    
    paths
}

/// 获取 Windows 系统上可能的 Node.js 路径
fn get_windows_node_paths() -> Vec<String> {
    let mut paths = Vec::new();
    
    // 1. 标准安装路径 (Program Files)
    paths.push("C:\\Program Files\\nodejs\\node.exe".to_string());
    paths.push("C:\\Program Files (x86)\\nodejs\\node.exe".to_string());
    
    // 2. nvm for Windows (nvm4w) - 常见安装位置
    paths.push("C:\\nvm4w\\nodejs\\node.exe".to_string());
    
    // 3. 用户目录下的各种安装
    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();
        
        // nvm for Windows 用户安装
        paths.push(format!("{}\\AppData\\Roaming\\nvm\\current\\node.exe", home_str));
        
        // fnm (Fast Node Manager) for Windows
        paths.push(format!("{}\\AppData\\Roaming\\fnm\\aliases\\default\\node.exe", home_str));
        paths.push(format!("{}\\AppData\\Local\\fnm\\aliases\\default\\node.exe", home_str));
        paths.push(format!("{}\\.fnm\\aliases\\default\\node.exe", home_str));
        
        // volta
        paths.push(format!("{}\\AppData\\Local\\Volta\\bin\\node.exe", home_str));
        // volta 通过 shim 调用，检查 bin 目录即可

        // Node 官方 MSI 的当前用户安装路径
        paths.push(format!("{}\\AppData\\Local\\Programs\\nodejs\\node.exe", home_str));
        
        // scoop 安装
        paths.push(format!("{}\\scoop\\apps\\nodejs\\current\\node.exe", home_str));
        paths.push(format!("{}\\scoop\\apps\\nodejs-lts\\current\\node.exe", home_str));
        
        // chocolatey 安装
        paths.push("C:\\ProgramData\\chocolatey\\lib\\nodejs\\tools\\node.exe".to_string());
    }
    
    // 4. 从注册表读取的安装路径（通过环境变量间接获取）
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        paths.push(format!("{}\\nodejs\\node.exe", program_files));
    }
    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        paths.push(format!("{}\\nodejs\\node.exe", program_files_x86));
    }
    if let Ok(local_app_data) = std::env::var("LocalAppData") {
        paths.push(format!("{}\\Programs\\nodejs\\node.exe", local_app_data));
    }
    
    // 5. nvm-windows 的符号链接路径（NVM_SYMLINK 环境变量）
    if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
        paths.insert(0, format!("{}\\node.exe", nvm_symlink));
    }
    
    // 6. nvm-windows 的 NVM_HOME 路径下的当前版本
    if let Ok(nvm_home) = std::env::var("NVM_HOME") {
        // 尝试读取当前激活的版本
        let settings_path = format!("{}\\settings.txt", nvm_home);
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            for line in content.lines() {
                if line.starts_with("current:") {
                    if let Some(version) = line.strip_prefix("current:") {
                        let version = version.trim();
                        if !version.is_empty() {
                            paths.insert(0, format!("{}\\v{}\\node.exe", nvm_home, version));
                        }
                    }
                }
            }
        }
    }
    
    paths
}

/// 获取 OpenClaw 版本
fn get_openclaw_version() -> Option<String> {
    // 使用 run_openclaw 统一处理各平台
    shell::run_openclaw(&["--version"])
        .ok()
        .map(|v| v.trim().to_string())
}

/// 检查 Node.js 版本是否 >= 22
fn check_node_version_requirement(version: &Option<String>) -> bool {
    if let Some(v) = version {
        // 解析版本号 "v22.1.0" -> 22
        let major = v.trim_start_matches('v')
            .split('.')
            .next()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        major >= 22
    } else {
        false
    }
}

/// 安装 Node.js
#[command]
pub async fn install_nodejs() -> Result<InstallResult, String> {
    info!("[安装Node.js] 开始安装 Node.js...");
    let os = platform::get_os();
    info!("[安装Node.js] 检测到操作系统: {}", os);
    
    let result = match os.as_str() {
        "windows" => {
            info!("[安装Node.js] 使用 Windows 安装方式...");
            install_nodejs_windows().await
        },
        "macos" => {
            info!("[安装Node.js] 使用 macOS 安装方式 (Homebrew)...");
            install_nodejs_macos().await
        },
        "linux" => {
            info!("[安装Node.js] 使用 Linux 安装方式...");
            install_nodejs_linux().await
        },
        _ => {
            error!("[安装Node.js] 不支持的操作系统: {}", os);
            Ok(InstallResult {
                success: false,
                message: "不支持的操作系统".to_string(),
                error: Some(format!("不支持的操作系统: {}", os)),
            })
        },
    };
    
    match &result {
        Ok(r) if r.success => info!("[安装Node.js] ✓ 安装成功"),
        Ok(r) => warn!("[安装Node.js] ✗ 安装失败: {}", r.message),
        Err(e) => error!("[安装Node.js] ✗ 安装错误: {}", e),
    }
    
    result
}

/// 使用管理员权限安装 Node.js（Windows）
#[command]
pub async fn install_nodejs_admin() -> Result<InstallResult, String> {
    if !platform::is_windows() {
        return install_nodejs().await;
    }

    info!("[安装Node.js][管理员] 开始管理员权限安装...");

    let script = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$logPath = Join-Path $env:TEMP 'openclaw_node_admin_install.log'

function Write-Log([string]$msg) {
  $time = Get-Date -Format 'HH:mm:ss'
  Add-Content -Path $logPath -Value "[$time] $msg"
}

Remove-Item $logPath -ErrorAction SilentlyContinue

try {
  Write-Log 'start admin node install'

  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $latest = $index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1
  if (-not $latest) {
    throw 'cannot resolve latest v22'
  }

  $msiName = "node-$($latest.version)-x64.msi"
  $url = "https://nodejs.org/dist/$($latest.version)/$msiName"
  $msiPath = Join-Path $env:TEMP $msiName

  Write-Log "download $url"
  Invoke-WebRequest -Uri $url -OutFile $msiPath

  Write-Log 'run msiexec as admin'
  $args = "/i `"$msiPath`" /qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1"
  $proc = Start-Process msiexec.exe -Verb RunAs -Wait -PassThru -ArgumentList $args
  Write-Log "msiexec exit: $($proc.ExitCode)"

  if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
    throw "msiexec failed with code $($proc.ExitCode)"
  }

  Write-Log 'admin install finished'
  Get-Content $logPath -Tail 40
  exit 0
} catch {
  Write-Log "error: $($_.Exception.Message)"
  if (Test-Path $logPath) {
    Get-Content $logPath -Tail 40
  } else {
    Write-Output 'no log generated'
  }
  exit 1
}
"#;

    match shell::run_powershell_output(script) {
        Ok(output) => {
            let env_status = collect_environment_status();
            if env_status.node_installed && env_status.node_version_ok {
                Ok(InstallResult {
                    success: true,
                    message: "Node.js 管理员安装成功。".to_string(),
                    error: None,
                })
            } else {
                Ok(InstallResult {
                    success: false,
                    message: "管理员安装已执行，但尚未检测到可用 Node.js 22+。".to_string(),
                    error: Some(output),
                })
            }
        }
        Err(e) => {
            let lower = e.to_lowercase();
            let message = if lower.contains("canceled") || lower.contains("cancelled") || lower.contains("拒绝") {
                "你取消了管理员授权，请再次点击并允许权限请求。"
            } else {
                "Node.js 管理员安装失败"
            };

            Ok(InstallResult {
                success: false,
                message: message.to_string(),
                error: Some(e),
            })
        }
    }
}

/// Windows 安装 Node.js
async fn install_nodejs_windows() -> Result<InstallResult, String> {
    // 优先使用 winget；失败时回退 Node 官方 MSI 安装；再失败回退 fnm
    let script = r#"
$ErrorActionPreference = 'Stop'

# 检查是否已安装
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        Write-Host "Node.js 已安装: $nodeVersion"
        exit 0
    }
}

# 优先使用 winget
$hasWinget = Get-Command winget -ErrorAction SilentlyContinue
if ($hasWinget) {
    Write-Host "使用 winget 安装 Node.js..."
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Node.js 安装成功！"
        exit 0
    }
    Write-Host "winget 安装失败，尝试官方 MSI..."
}

# 备用方案 1：Node 官方 MSI（尽量使用当前用户安装，减少管理员依赖）
try {
    $index = Invoke-RestMethod "https://nodejs.org/dist/index.json"
    $latest = $index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1
    if ($latest) {
        $msiName = "node-$($latest.version)-x64.msi"
        $url = "https://nodejs.org/dist/$($latest.version)/$msiName"
        $msiPath = Join-Path $env:TEMP $msiName

        Write-Host "下载官方安装包: $url"
        Invoke-WebRequest -Uri $url -OutFile $msiPath

        Write-Host "执行 MSI 安装..."
        Start-Process msiexec.exe -Wait -ArgumentList '/i', $msiPath, '/qn', '/norestart', 'ALLUSERS=2', 'MSIINSTALLPERUSER=1'
        if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 3010) {
            $nodeVersion = node --version 2>$null
            if ($nodeVersion) {
                Write-Host "Node.js MSI 安装成功: $nodeVersion"
                exit 0
            }
            Write-Host "MSI 安装完成，但当前会话未检测到 node 命令。"
        } else {
            Write-Host "MSI 安装失败，退出码: $LASTEXITCODE"
        }
    }
} catch {
    Write-Host "官方 MSI 安装失败: $($_.Exception.Message)"
}

# 备用方案 2：使用 fnm (Fast Node Manager)
Write-Host "尝试使用 fnm 安装 Node.js..."
$fnmInstallScript = "irm https://fnm.vercel.app/install.ps1 | iex"
Invoke-Expression $fnmInstallScript

# 配置 fnm 环境
$env:FNM_DIR = "$env:USERPROFILE\.fnm"
$env:Path = "$env:FNM_DIR;$env:Path"

# 安装 Node.js 22
fnm install 22
fnm default 22
fnm use 22

# 验证安装
$nodeVersion = node --version 2>$null
if ($nodeVersion) {
    Write-Host "Node.js 安装成功: $nodeVersion"
    exit 0
} else {
    Write-Host "Node.js 安装失败"
    exit 1
}
"#;
    
    match shell::run_powershell_output(script) {
        Ok(output) => {
            // 验证安装
            if get_node_version().is_some() {
                Ok(InstallResult {
                    success: true,
                    message: "Node.js 安装成功！请重启应用以使环境变量生效。".to_string(),
                    error: None,
                })
            } else {
                Ok(InstallResult {
                    success: false,
                    message: "安装后需要重启应用".to_string(),
                    error: Some(output),
                })
            }
        }
        Err(e) => Ok(InstallResult {
            success: false,
            message: "Node.js 安装失败".to_string(),
            error: Some(e),
        }),
    }
}

/// macOS 安装 Node.js
async fn install_nodejs_macos() -> Result<InstallResult, String> {
    // 使用 Homebrew 安装
    let script = r#"
# 检查 Homebrew
if ! command -v brew &> /dev/null; then
    echo "安装 Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # 配置 PATH
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

echo "安装 Node.js 22..."
brew install node@22
brew link --overwrite node@22

# 验证安装
node --version
"#;
    
    match shell::run_bash_output(script) {
        Ok(output) => Ok(InstallResult {
            success: true,
            message: format!("Node.js 安装成功！{}", output),
            error: None,
        }),
        Err(e) => Ok(InstallResult {
            success: false,
            message: "Node.js 安装失败".to_string(),
            error: Some(e),
        }),
    }
}

/// Linux 安装 Node.js
async fn install_nodejs_linux() -> Result<InstallResult, String> {
    // 使用 NodeSource 仓库安装
    let script = r#"
# 检测包管理器
if command -v apt-get &> /dev/null; then
    echo "检测到 apt，使用 NodeSource 仓库..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
elif command -v dnf &> /dev/null; then
    echo "检测到 dnf，使用 NodeSource 仓库..."
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo dnf install -y nodejs
elif command -v yum &> /dev/null; then
    echo "检测到 yum，使用 NodeSource 仓库..."
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo yum install -y nodejs
elif command -v pacman &> /dev/null; then
    echo "检测到 pacman..."
    sudo pacman -S nodejs npm --noconfirm
else
    echo "无法检测到支持的包管理器"
    exit 1
fi

# 验证安装
node --version
"#;
    
    match shell::run_bash_output(script) {
        Ok(output) => Ok(InstallResult {
            success: true,
            message: format!("Node.js 安装成功！{}", output),
            error: None,
        }),
        Err(e) => Ok(InstallResult {
            success: false,
            message: "Node.js 安装失败".to_string(),
            error: Some(e),
        }),
    }
}

/// 安装 OpenClaw
#[command]
pub async fn install_openclaw() -> Result<InstallResult, String> {
    info!("[安装OpenClaw] 开始安装 OpenClaw...");
    let os = platform::get_os();
    info!("[安装OpenClaw] 检测到操作系统: {}", os);
    
    let result = match os.as_str() {
        "windows" => {
            info!("[安装OpenClaw] 使用 Windows 安装方式...");
            install_openclaw_windows().await
        },
        _ => {
            info!("[安装OpenClaw] 使用 Unix 安装方式 (npm)...");
            install_openclaw_unix().await
        },
    };
    
    match &result {
        Ok(r) if r.success => info!("[安装OpenClaw] ✓ 安装成功"),
        Ok(r) => warn!("[安装OpenClaw] ✗ 安装失败: {}", r.message),
        Err(e) => error!("[安装OpenClaw] ✗ 安装错误: {}", e),
    }
    
    result
}

/// Windows 安装 OpenClaw
async fn install_openclaw_windows() -> Result<InstallResult, String> {
    let script = r#"
$ErrorActionPreference = 'Stop'

# 检查 Node.js
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "错误：请先安装 Node.js"
    exit 1
}

Write-Host "使用 npm 安装 OpenClaw..."

# 首次尝试官方源
$installOk = $false
try {
    npm install -g openclaw@latest --unsafe-perm
    if ($LASTEXITCODE -eq 0) {
        $installOk = $true
    }
} catch {
    $installOk = $false
}

# 官方源失败时，自动回退到稳定线路
if (-not $installOk) {
    Write-Host "官方源安装失败，尝试稳定线路（npmmirror）..."
    npm install -g openclaw@latest --unsafe-perm --registry=https://registry.npmmirror.com/
    if ($LASTEXITCODE -eq 0) {
        $installOk = $true
    }
}

# 验证安装
$openclawVersion = openclaw --version 2>$null
if ($installOk -and $openclawVersion) {
    Write-Host "OpenClaw 安装成功: $openclawVersion"
    exit 0
} else {
    Write-Host "OpenClaw 安装失败，请检查网络连接或代理设置"
    exit 1
}
"#;
    
    match shell::run_powershell_output(script) {
        Ok(output) => {
            if get_openclaw_version().is_some() {
                Ok(InstallResult {
                    success: true,
                    message: "OpenClaw 安装成功！".to_string(),
                    error: None,
                })
            } else {
                Ok(InstallResult {
                    success: false,
                    message: "安装后需要重启应用".to_string(),
                    error: Some(output),
                })
            }
        }
        Err(e) => Ok(InstallResult {
            success: false,
            message: "OpenClaw 安装失败".to_string(),
            error: Some(e),
        }),
    }
}

/// Unix 系统安装 OpenClaw
async fn install_openclaw_unix() -> Result<InstallResult, String> {
    let script = r#"
# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误：请先安装 Node.js"
    exit 1
fi

echo "使用 npm 安装 OpenClaw..."

# 先尝试官方源
if npm install -g openclaw@latest --unsafe-perm; then
  echo "官方源安装成功"
else
  echo "官方源安装失败，尝试稳定线路（npmmirror）..."
  npm install -g openclaw@latest --unsafe-perm --registry=https://registry.npmmirror.com/
fi

# 验证安装
openclaw --version
"#;
    
    match shell::run_bash_output(script) {
        Ok(output) => Ok(InstallResult {
            success: true,
            message: format!("OpenClaw 安装成功！{}", output),
            error: None,
        }),
        Err(e) => Ok(InstallResult {
            success: false,
            message: "OpenClaw 安装失败".to_string(),
            error: Some(e),
        }),
    }
}

/// 初始化 OpenClaw 配置
#[command]
pub async fn init_openclaw_config() -> Result<InstallResult, String> {
    info!("[初始化配置] 开始初始化 OpenClaw 配置...");
    
    let config_dir = platform::get_config_dir();
    info!("[初始化配置] 配置目录: {}", config_dir);
    
    // 创建配置目录
    info!("[初始化配置] 创建配置目录...");
    if let Err(e) = std::fs::create_dir_all(&config_dir) {
        error!("[初始化配置] ✗ 创建配置目录失败: {}", e);
        return Ok(InstallResult {
            success: false,
            message: "创建配置目录失败".to_string(),
            error: Some(e.to_string()),
        });
    }
    
    // 创建子目录
    let subdirs = ["agents/main/sessions", "agents/main/agent", "credentials"];
    for subdir in subdirs {
        let path = format!("{}/{}", config_dir, subdir);
        info!("[初始化配置] 创建子目录: {}", subdir);
        if let Err(e) = std::fs::create_dir_all(&path) {
            error!("[初始化配置] ✗ 创建目录失败: {} - {}", subdir, e);
            return Ok(InstallResult {
                success: false,
                message: format!("创建目录失败: {}", subdir),
                error: Some(e.to_string()),
            });
        }
    }
    
    // 设置配置目录权限为 700（与 shell 脚本 chmod 700 一致）
    // 仅在 Unix 系统上执行
    #[cfg(unix)]
    {
        info!("[初始化配置] 设置目录权限为 700...");
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&config_dir) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o700);
            if let Err(e) = std::fs::set_permissions(&config_dir, perms) {
                warn!("[初始化配置] 设置权限失败: {}", e);
            } else {
                info!("[初始化配置] ✓ 权限设置成功");
            }
        }
    }
    
    // 设置 gateway mode 为 local
    info!("[初始化配置] 执行: openclaw config set gateway.mode local");
    let result = shell::run_openclaw(&["config", "set", "gateway.mode", "local"]);
    
    match result {
        Ok(output) => {
            info!("[初始化配置] ✓ 配置初始化成功");
            debug!("[初始化配置] 命令输出: {}", output);
            Ok(InstallResult {
                success: true,
                message: "配置初始化成功！".to_string(),
                error: None,
            })
        },
        Err(e) => {
            error!("[初始化配置] ✗ 配置初始化失败: {}", e);
            Ok(InstallResult {
                success: false,
                message: "配置初始化失败".to_string(),
                error: Some(e),
            })
        },
    }
}

/// 打开终端执行安装脚本（用于需要管理员权限的场景）
#[command]
pub async fn open_install_terminal(install_type: String) -> Result<String, String> {
    match install_type.as_str() {
        "nodejs" => open_nodejs_install_terminal().await,
        "openclaw" => open_openclaw_install_terminal().await,
        _ => Err(format!("未知的安装类型: {}", install_type)),
    }
}

/// 打开终端安装 Node.js
async fn open_nodejs_install_terminal() -> Result<String, String> {
    if platform::is_windows() {
        // Windows: 打开 PowerShell 执行安装
        let script = r#"
Start-Process powershell -ArgumentList '-NoExit', '-Command', '
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    Node.js 安装向导" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 winget
$hasWinget = Get-Command winget -ErrorAction SilentlyContinue
if ($hasWinget) {
    Write-Host "正在使用 winget 安装 Node.js 22..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "请从以下地址下载安装 Node.js:" -ForegroundColor Yellow
    Write-Host "https://nodejs.org/en/download" -ForegroundColor Green
    Write-Host ""
    Start-Process "https://nodejs.org/en/download"
}

Write-Host ""
Write-Host "安装完成后请重启 OpenClaw Manager" -ForegroundColor Green
Write-Host ""
Read-Host "按回车键关闭此窗口"
' -Verb RunAs
"#;
        shell::run_powershell_output(script)?;
        Ok("已打开安装终端".to_string())
    } else if platform::is_macos() {
        // macOS: 打开 Terminal.app
        let script_content = r#"#!/bin/bash
clear
echo "========================================"
echo "    Node.js 安装向导"
echo "========================================"
echo ""

# 检查 Homebrew
if ! command -v brew &> /dev/null; then
    echo "正在安装 Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

echo "正在安装 Node.js 22..."
brew install node@22
brew link --overwrite node@22

echo ""
echo "安装完成！"
node --version
echo ""
read -p "按回车键关闭此窗口..."
"#;
        
        let script_path = "/tmp/openclaw_install_nodejs.command";
        std::fs::write(script_path, script_content)
            .map_err(|e| format!("创建脚本失败: {}", e))?;
        
        std::process::Command::new("chmod")
            .args(["+x", script_path])
            .output()
            .map_err(|e| format!("设置权限失败: {}", e))?;
        
        std::process::Command::new("open")
            .arg(script_path)
            .spawn()
            .map_err(|e| format!("启动终端失败: {}", e))?;
        
        Ok("已打开安装终端".to_string())
    } else {
        Err("请手动安装 Node.js: https://nodejs.org/".to_string())
    }
}

/// 打开终端安装 OpenClaw
async fn open_openclaw_install_terminal() -> Result<String, String> {
    if platform::is_windows() {
        let script = r#"
Start-Process powershell -ArgumentList '-NoExit', '-Command', '
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    OpenClaw 安装向导" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "正在安装 OpenClaw..." -ForegroundColor Yellow
npm install -g openclaw@latest

Write-Host ""
Write-Host "初始化配置..."
openclaw config set gateway.mode local

Write-Host ""
Write-Host "安装完成！" -ForegroundColor Green
openclaw --version
Write-Host ""
Read-Host "按回车键关闭此窗口"
'
"#;
        shell::run_powershell_output(script)?;
        Ok("已打开安装终端".to_string())
    } else if platform::is_macos() {
        let script_content = r#"#!/bin/bash
clear
echo "========================================"
echo "    OpenClaw 安装向导"
echo "========================================"
echo ""

echo "正在安装 OpenClaw..."
npm install -g openclaw@latest

echo ""
echo "初始化配置..."
openclaw config set gateway.mode local 2>/dev/null || true

mkdir -p ~/.openclaw/agents/main/sessions
mkdir -p ~/.openclaw/agents/main/agent
mkdir -p ~/.openclaw/credentials

echo ""
echo "安装完成！"
openclaw --version
echo ""
read -p "按回车键关闭此窗口..."
"#;
        
        let script_path = "/tmp/openclaw_install_openclaw.command";
        std::fs::write(script_path, script_content)
            .map_err(|e| format!("创建脚本失败: {}", e))?;
        
        std::process::Command::new("chmod")
            .args(["+x", script_path])
            .output()
            .map_err(|e| format!("设置权限失败: {}", e))?;
        
        std::process::Command::new("open")
            .arg(script_path)
            .spawn()
            .map_err(|e| format!("启动终端失败: {}", e))?;
        
        Ok("已打开安装终端".to_string())
    } else {
        // Linux
        let script_content = r#"#!/bin/bash
clear
echo "========================================"
echo "    OpenClaw 安装向导"
echo "========================================"
echo ""

echo "正在安装 OpenClaw..."
npm install -g openclaw@latest

echo ""
echo "初始化配置..."
openclaw config set gateway.mode local 2>/dev/null || true

mkdir -p ~/.openclaw/agents/main/sessions
mkdir -p ~/.openclaw/agents/main/agent
mkdir -p ~/.openclaw/credentials

echo ""
echo "安装完成！"
openclaw --version
echo ""
read -p "按回车键关闭..."
"#;
        
        let script_path = "/tmp/openclaw_install_openclaw.sh";
        std::fs::write(script_path, script_content)
            .map_err(|e| format!("创建脚本失败: {}", e))?;
        
        std::process::Command::new("chmod")
            .args(["+x", script_path])
            .output()
            .map_err(|e| format!("设置权限失败: {}", e))?;
        
        // 尝试不同的终端
        let terminals = ["gnome-terminal", "xfce4-terminal", "konsole", "xterm"];
        for term in terminals {
            if std::process::Command::new(term)
                .args(["--", script_path])
                .spawn()
                .is_ok()
            {
                return Ok("已打开安装终端".to_string());
            }
        }
        
        Err("无法启动终端，请手动运行: npm install -g openclaw".to_string())
    }
}

/// 卸载 OpenClaw
#[command]
pub async fn uninstall_openclaw() -> Result<InstallResult, String> {
    info!("[卸载OpenClaw] 开始卸载 OpenClaw...");
    let os = platform::get_os();
    info!("[卸载OpenClaw] 检测到操作系统: {}", os);
    let was_installed = get_openclaw_version().is_some();
    
    // 先停止服务
    info!("[卸载OpenClaw] 尝试停止服务...");
    let _ = shell::run_openclaw(&["gateway", "stop"]);
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    let result = if was_installed {
        match os.as_str() {
            "windows" => {
                info!("[卸载OpenClaw] 使用 Windows 卸载方式...");
                uninstall_openclaw_windows().await
            },
            _ => {
                info!("[卸载OpenClaw] 使用 Unix 卸载方式 (npm)...");
                uninstall_openclaw_unix().await
            },
        }
    } else {
        info!("[卸载OpenClaw] 未检测到 OpenClaw 安装，跳过 CLI 卸载");
        Ok(InstallResult {
            success: true,
            message: "未检测到 OpenClaw 安装，已跳过 CLI 卸载。".to_string(),
            error: None,
        })
    };
    
    match result {
        Ok(mut r) => {
            match cleanup_openclaw_data() {
                Ok(cleanup_note) => {
                    if r.success {
                        r.message = format!("{} {}", r.message, cleanup_note);
                        info!("[卸载OpenClaw] ✓ 卸载并清理完成");
                    } else {
                        warn!("[卸载OpenClaw] CLI 卸载失败，但尝试清理配置完成: {}", r.message);
                        r.message = format!("{} 已尝试清理本地配置。", r.message);
                    }
                    Ok(r)
                }
                Err(cleanup_err) => {
                    warn!("[卸载OpenClaw] 配置清理失败: {}", cleanup_err);
                    if r.error.is_none() {
                        r.error = Some(cleanup_err);
                    }
                    Ok(r)
                }
            }
        }
        Err(e) => {
            error!("[卸载OpenClaw] ✗ 卸载错误: {}", e);
            Ok(InstallResult {
                success: false,
                message: "卸载过程中发生错误".to_string(),
                error: Some(e),
            })
        }
    }
}

fn cleanup_openclaw_data() -> Result<String, String> {
    let config_dir = platform::get_config_dir();
    let path = std::path::Path::new(&config_dir);

    if !path.exists() {
        return Ok("本地配置已是空状态。".to_string());
    }

    std::fs::remove_dir_all(path)
        .map_err(|e| format!("清理本地配置失败: {}", e))?;

    Ok("已清理 ~/.openclaw 配置目录，可从头安装测试。".to_string())
}

/// Windows 卸载 OpenClaw
async fn uninstall_openclaw_windows() -> Result<InstallResult, String> {
    // 使用 cmd.exe 执行 npm uninstall，避免 PowerShell 执行策略问题
    info!("[卸载OpenClaw] 执行 npm uninstall -g openclaw...");
    
    match shell::run_cmd_output("npm uninstall -g openclaw") {
        Ok(output) => {
            info!("[卸载OpenClaw] npm 输出: {}", output);
            
            // 验证卸载是否成功
            std::thread::sleep(std::time::Duration::from_millis(500));
            if get_openclaw_version().is_none() {
                Ok(InstallResult {
                    success: true,
                    message: "OpenClaw 已成功卸载！".to_string(),
                    error: None,
                })
            } else {
                Ok(InstallResult {
                    success: false,
                    message: "卸载命令已执行，但 OpenClaw 仍然存在，请尝试手动卸载".to_string(),
                    error: Some(output),
                })
            }
        }
        Err(e) => {
            warn!("[卸载OpenClaw] npm uninstall 失败: {}", e);
            Ok(InstallResult {
                success: false,
                message: "OpenClaw 卸载失败".to_string(),
                error: Some(e),
            })
        }
    }
}

/// Unix 系统卸载 OpenClaw
async fn uninstall_openclaw_unix() -> Result<InstallResult, String> {
    let script = r#"
echo "卸载 OpenClaw..."
npm uninstall -g openclaw

# 验证卸载
if command -v openclaw &> /dev/null; then
    echo "警告：openclaw 命令仍然存在"
    exit 1
else
    echo "OpenClaw 已成功卸载"
    exit 0
fi
"#;
    
    match shell::run_bash_output(script) {
        Ok(output) => Ok(InstallResult {
            success: true,
            message: format!("OpenClaw 已成功卸载！{}", output),
            error: None,
        }),
        Err(e) => Ok(InstallResult {
            success: false,
            message: "OpenClaw 卸载失败".to_string(),
            error: Some(e),
        }),
    }
}

/// 版本更新信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    /// 是否有更新可用
    pub update_available: bool,
    /// 当前版本
    pub current_version: Option<String>,
    /// 最新版本
    pub latest_version: Option<String>,
    /// 错误信息
    pub error: Option<String>,
}

/// 检查 OpenClaw 更新
#[command]
pub async fn check_openclaw_update() -> Result<UpdateInfo, String> {
    info!("[版本检查] 开始检查 OpenClaw 更新...");
    
    // 获取当前版本
    let current_version = get_openclaw_version();
    info!("[版本检查] 当前版本: {:?}", current_version);
    
    if current_version.is_none() {
        info!("[版本检查] OpenClaw 未安装");
        return Ok(UpdateInfo {
            update_available: false,
            current_version: None,
            latest_version: None,
            error: Some("OpenClaw 未安装".to_string()),
        });
    }
    
    // 获取最新版本
    let latest_version = get_latest_openclaw_version();
    info!("[版本检查] 最新版本: {:?}", latest_version);
    
    if latest_version.is_none() {
        return Ok(UpdateInfo {
            update_available: false,
            current_version,
            latest_version: None,
            error: Some("无法获取最新版本信息".to_string()),
        });
    }
    
    // 比较版本
    let current = current_version.clone().unwrap();
    let latest = latest_version.clone().unwrap();
    let update_available = compare_versions(&current, &latest);
    
    info!("[版本检查] 是否有更新: {}", update_available);
    
    Ok(UpdateInfo {
        update_available,
        current_version,
        latest_version,
        error: None,
    })
}

/// 获取 npm registry 上的最新版本
fn get_latest_openclaw_version() -> Option<String> {
    // 使用 npm view 获取最新版本
    let result = if platform::is_windows() {
        shell::run_cmd_output("npm view openclaw version")
    } else {
        shell::run_bash_output("npm view openclaw version 2>/dev/null")
    };
    
    match result {
        Ok(version) => {
            let v = version.trim().to_string();
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        }
        Err(e) => {
            warn!("[版本检查] 获取最新版本失败: {}", e);
            None
        }
    }
}

/// 比较版本号，返回是否有更新可用
/// current: 当前版本 (如 "1.0.0" 或 "v1.0.0")
/// latest: 最新版本 (如 "1.0.1")
fn compare_versions(current: &str, latest: &str) -> bool {
    // 移除可能的 'v' 前缀和空白
    let current = current.trim().trim_start_matches('v');
    let latest = latest.trim().trim_start_matches('v');
    
    // 分割版本号
    let current_parts: Vec<u32> = current
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    let latest_parts: Vec<u32> = latest
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    
    // 比较每个部分
    for i in 0..3 {
        let c = current_parts.get(i).unwrap_or(&0);
        let l = latest_parts.get(i).unwrap_or(&0);
        if l > c {
            return true;
        } else if l < c {
            return false;
        }
    }
    
    false
}

/// 更新 OpenClaw
#[command]
pub async fn update_openclaw() -> Result<InstallResult, String> {
    info!("[更新OpenClaw] 开始更新 OpenClaw...");
    let os = platform::get_os();
    
    // 先停止服务
    info!("[更新OpenClaw] 尝试停止服务...");
    let _ = shell::run_openclaw(&["gateway", "stop"]);
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    let result = match os.as_str() {
        "windows" => {
            info!("[更新OpenClaw] 使用 Windows 更新方式...");
            update_openclaw_windows().await
        },
        _ => {
            info!("[更新OpenClaw] 使用 Unix 更新方式 (npm)...");
            update_openclaw_unix().await
        },
    };
    
    match &result {
        Ok(r) if r.success => info!("[更新OpenClaw] ✓ 更新成功"),
        Ok(r) => warn!("[更新OpenClaw] ✗ 更新失败: {}", r.message),
        Err(e) => error!("[更新OpenClaw] ✗ 更新错误: {}", e),
    }
    
    result
}

/// Windows 更新 OpenClaw
async fn update_openclaw_windows() -> Result<InstallResult, String> {
    info!("[更新OpenClaw] 执行 npm install -g openclaw@latest...");
    
    match shell::run_cmd_output("npm install -g openclaw@latest") {
        Ok(output) => {
            info!("[更新OpenClaw] npm 输出: {}", output);
            
            // 获取新版本
            let new_version = get_openclaw_version();
            
            Ok(InstallResult {
                success: true,
                message: format!("OpenClaw 已更新到 {}", new_version.unwrap_or("最新版本".to_string())),
                error: None,
            })
        }
        Err(e) => {
            warn!("[更新OpenClaw] npm install 失败: {}", e);
            Ok(InstallResult {
                success: false,
                message: "OpenClaw 更新失败".to_string(),
                error: Some(e),
            })
        }
    }
}

/// Unix 系统更新 OpenClaw
async fn update_openclaw_unix() -> Result<InstallResult, String> {
    let script = r#"
echo "更新 OpenClaw..."
npm install -g openclaw@latest

# 验证更新
openclaw --version
"#;
    
    match shell::run_bash_output(script) {
        Ok(output) => Ok(InstallResult {
            success: true,
            message: format!("OpenClaw 已更新！{}", output),
            error: None,
        }),
        Err(e) => Ok(InstallResult {
            success: false,
            message: "OpenClaw 更新失败".to_string(),
            error: Some(e),
        }),
    }
}
