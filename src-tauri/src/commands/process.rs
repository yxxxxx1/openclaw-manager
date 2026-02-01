use crate::utils::shell;
use tauri::command;

/// 检查 OpenClaw 是否已安装
#[command]
pub async fn check_openclaw_installed() -> Result<bool, String> {
    Ok(shell::command_exists("openclaw"))
}

/// 获取 OpenClaw 版本
#[command]
pub async fn get_openclaw_version() -> Result<Option<String>, String> {
    if !shell::command_exists("openclaw") {
        return Ok(None);
    }
    
    match shell::run_command_output("openclaw", &["--version"]) {
        Ok(version) => Ok(Some(version)),
        Err(_) => Ok(None),
    }
}

/// 检查端口是否被占用
#[command]
pub async fn check_port_in_use(port: u16) -> Result<bool, String> {
    let result = shell::run_bash_output(&format!("lsof -ti :{}", port));
    Ok(result.is_ok() && !result.unwrap().is_empty())
}

/// 获取 Node.js 版本
#[command]
pub async fn get_node_version() -> Result<Option<String>, String> {
    if !shell::command_exists("node") {
        return Ok(None);
    }
    
    match shell::run_command_output("node", &["--version"]) {
        Ok(version) => Ok(Some(version)),
        Err(_) => Ok(None),
    }
}
