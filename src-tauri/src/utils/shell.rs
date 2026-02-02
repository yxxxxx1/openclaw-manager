use std::process::{Command, Output};
use std::io;
use std::collections::HashMap;
use crate::utils::platform;
use crate::utils::file;
use log::{info, debug, warn};

/// 执行 Shell 命令
pub fn run_command(cmd: &str, args: &[&str]) -> io::Result<Output> {
    Command::new(cmd)
        .args(args)
        .output()
}

/// 执行 Shell 命令并获取输出字符串
pub fn run_command_output(cmd: &str, args: &[&str]) -> Result<String, String> {
    match run_command(cmd, args) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 执行 Bash 命令
pub fn run_bash(script: &str) -> io::Result<Output> {
    Command::new("bash")
        .arg("-c")
        .arg(script)
        .output()
}

/// 执行 Bash 命令并获取输出
pub fn run_bash_output(script: &str) -> Result<String, String> {
    match run_bash(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    Err(format!("Command failed with exit code: {:?}", output.status.code()))
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 执行 PowerShell 命令（Windows）
pub fn run_powershell(script: &str) -> io::Result<Output> {
    Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
}

/// 执行 PowerShell 命令并获取输出（Windows）
pub fn run_powershell_output(script: &str) -> Result<String, String> {
    match run_powershell(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if stdout.is_empty() {
                        Err(format!("Command failed with exit code: {:?}", output.status.code()))
                    } else {
                        Err(stdout)
                    }
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 跨平台执行脚本命令
pub fn run_script_output(script: &str) -> Result<String, String> {
    if platform::is_windows() {
        run_powershell_output(script)
    } else {
        run_bash_output(script)
    }
}

/// 后台执行命令（不等待结果）
pub fn spawn_background(script: &str) -> io::Result<()> {
    if platform::is_windows() {
        Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .spawn()?;
    } else {
        Command::new("bash")
            .arg("-c")
            .arg(script)
            .spawn()?;
    }
    Ok(())
}

/// 获取 openclaw 可执行文件路径
/// Windows 上会尝试从常见安装目录查找
pub fn get_openclaw_path() -> Option<String> {
    // Windows: 检查常见的 npm 全局安装路径
    if platform::is_windows() {
        let possible_paths = get_windows_openclaw_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }
    
    // 回退：检查是否在 PATH 中
    if command_exists("openclaw") {
        return Some("openclaw".to_string());
    }
    
    None
}

/// 获取 Windows 上可能的 openclaw 安装路径
fn get_windows_openclaw_paths() -> Vec<String> {
    let mut paths = Vec::new();
    
    // 1. nvm4w 安装路径
    paths.push("C:\\nvm4w\\nodejs\\openclaw.cmd".to_string());
    
    // 2. 用户目录下的 npm 全局路径
    if let Some(home) = dirs::home_dir() {
        let npm_path = format!("{}\\AppData\\Roaming\\npm\\openclaw.cmd", home.display());
        paths.push(npm_path);
    }
    
    // 3. Program Files 下的 nodejs
    paths.push("C:\\Program Files\\nodejs\\openclaw.cmd".to_string());
    
    paths
}

/// 执行 openclaw 命令并获取输出
pub fn run_openclaw(args: &[&str]) -> Result<String, String> {
    debug!("[Shell] 执行 openclaw 命令: {:?}", args);
    
    let openclaw_path = get_openclaw_path().ok_or_else(|| {
        warn!("[Shell] 找不到 openclaw 命令");
        "找不到 openclaw 命令，请确保已通过 npm install -g openclaw 安装".to_string()
    })?;
    
    debug!("[Shell] openclaw 路径: {}", openclaw_path);
    
    let output = if openclaw_path.ends_with(".cmd") {
        // Windows: .cmd 文件需要通过 cmd /c 执行
        let mut cmd_args = vec!["/c", &openclaw_path];
        cmd_args.extend(args);
        Command::new("cmd")
            .args(&cmd_args)
            .env("OPENCLAW_GATEWAY_TOKEN", DEFAULT_GATEWAY_TOKEN)
            .output()
    } else {
        Command::new(&openclaw_path)
            .args(args)
            .env("OPENCLAW_GATEWAY_TOKEN", DEFAULT_GATEWAY_TOKEN)
            .output()
    };
    
    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            debug!("[Shell] 命令退出码: {:?}", out.status.code());
            if out.status.success() {
                debug!("[Shell] 命令执行成功, stdout 长度: {}", stdout.len());
                Ok(stdout)
            } else {
                debug!("[Shell] 命令执行失败, stderr: {}", stderr);
                Err(format!("{}\n{}", stdout, stderr).trim().to_string())
            }
        }
        Err(e) => {
            warn!("[Shell] 执行 openclaw 失败: {}", e);
            Err(format!("执行 openclaw 失败: {}", e))
        }
    }
}

/// 默认的 Gateway Token
pub const DEFAULT_GATEWAY_TOKEN: &str = "openclaw-manager-local-token";

/// 从 ~/.openclaw/env 文件读取所有环境变量
/// 与 shell 脚本 `source ~/.openclaw/env` 行为一致
fn load_openclaw_env_vars() -> HashMap<String, String> {
    let mut env_vars = HashMap::new();
    let env_path = platform::get_env_file_path();
    
    if let Ok(content) = file::read_file(&env_path) {
        for line in content.lines() {
            let line = line.trim();
            // 跳过注释和空行
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // 解析 export KEY=VALUE 或 KEY=VALUE 格式
            let line = line.strip_prefix("export ").unwrap_or(line);
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                // 去除值周围的引号
                let value = value.trim()
                    .trim_matches('"')
                    .trim_matches('\'');
                env_vars.insert(key.to_string(), value.to_string());
            }
        }
    }
    
    env_vars
}

/// 后台启动 openclaw gateway
/// 与 shell 脚本行为一致：先加载 env 文件，再启动 gateway
pub fn spawn_openclaw_gateway() -> io::Result<()> {
    info!("[Shell] 后台启动 openclaw gateway...");
    
    let openclaw_path = get_openclaw_path().ok_or_else(|| {
        warn!("[Shell] 找不到 openclaw 命令");
        io::Error::new(
            io::ErrorKind::NotFound,
            "找不到 openclaw 命令，请确保已通过 npm install -g openclaw 安装"
        )
    })?;
    
    info!("[Shell] openclaw 路径: {}", openclaw_path);
    
    // 加载用户的 env 文件环境变量（与 shell 脚本 source ~/.openclaw/env 一致）
    info!("[Shell] 加载用户环境变量...");
    let user_env_vars = load_openclaw_env_vars();
    info!("[Shell] 已加载 {} 个环境变量", user_env_vars.len());
    for key in user_env_vars.keys() {
        debug!("[Shell] - 环境变量: {}", key);
    }
    
    // Windows 上 .cmd 文件需要通过 cmd /c 来执行
    // 设置环境变量 OPENCLAW_GATEWAY_TOKEN，这样所有子命令都能自动使用
    let mut cmd = if openclaw_path.ends_with(".cmd") {
        info!("[Shell] Windows 模式: 使用 cmd /c 执行");
        let mut c = Command::new("cmd");
        c.args(["/c", &openclaw_path, "gateway", "--port", "18789"]);
        c
    } else {
        info!("[Shell] Unix 模式: 直接执行");
        let mut c = Command::new(&openclaw_path);
        c.args(["gateway", "--port", "18789"]);
        c
    };
    
    // 注入用户的环境变量（如 ANTHROPIC_API_KEY, OPENAI_API_KEY 等）
    for (key, value) in &user_env_vars {
        cmd.env(key, value);
    }
    
    // 设置 gateway token
    cmd.env("OPENCLAW_GATEWAY_TOKEN", DEFAULT_GATEWAY_TOKEN);
    
    info!("[Shell] 启动 gateway 进程...");
    let child = cmd.spawn();
    
    match child {
        Ok(c) => {
            info!("[Shell] ✓ Gateway 进程已启动, PID: {}", c.id());
            Ok(())
        }
        Err(e) => {
            warn!("[Shell] ✗ Gateway 启动失败: {}", e);
            Err(io::Error::new(
                e.kind(),
                format!("启动失败 (路径: {}): {}", openclaw_path, e)
            ))
        }
    }
}

/// 检查命令是否存在
pub fn command_exists(cmd: &str) -> bool {
    if platform::is_windows() {
        // Windows: 使用 where 命令
        Command::new("where")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        // Unix: 使用 which 命令
        Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
