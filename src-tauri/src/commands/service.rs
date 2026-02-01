use crate::models::ServiceStatus;
use crate::utils::{file, platform, shell};
use tauri::command;

/// 获取服务状态
#[command]
pub async fn get_service_status() -> Result<ServiceStatus, String> {
    // 检查 openclaw gateway 进程
    let result = shell::run_command_output("pgrep", &["-f", "openclaw.*gateway"]);
    
    let (running, pid) = match result {
        Ok(ref output) => {
            let pid = output.lines().next().and_then(|s: &str| s.parse::<u32>().ok());
            (true, pid)
        }
        Err(_) => (false, None),
    };
    
    // 获取内存使用（仅在运行时）
    let memory_mb = if let Some(p) = pid {
        shell::run_bash_output(&format!("ps -o rss= -p {}", p))
            .ok()
            .and_then(|s: String| s.trim().parse::<f64>().ok())
            .map(|kb| kb / 1024.0)
    } else {
        None
    };
    
    Ok(ServiceStatus {
        running,
        pid,
        port: 18789,
        uptime_seconds: None,
        memory_mb,
        cpu_percent: None,
    })
}

/// 启动服务
#[command]
pub async fn start_service() -> Result<String, String> {
    // 检查是否已经运行
    let status = get_service_status().await?;
    if status.running {
        return Err("服务已在运行中".to_string());
    }
    
    let env_file = platform::get_env_file_path();
    let log_file = platform::get_log_file_path();
    
    // 构建启动命令
    let start_cmd = if file::file_exists(&env_file) {
        format!(
            "source {} && nohup openclaw gateway --port 18789 > {} 2>&1 &",
            env_file, log_file
        )
    } else {
        format!(
            "nohup openclaw gateway --port 18789 > {} 2>&1 &",
            log_file
        )
    };
    
    // 后台启动
    shell::spawn_background(&start_cmd)
        .map_err(|e| format!("启动服务失败: {}", e))?;
    
    // 等待一秒后检查状态
    std::thread::sleep(std::time::Duration::from_secs(1));
    
    let new_status = get_service_status().await?;
    if new_status.running {
        Ok(format!("服务已启动，PID: {:?}", new_status.pid))
    } else {
        Err("服务启动失败，请查看日志".to_string())
    }
}

/// 停止服务
#[command]
pub async fn stop_service() -> Result<String, String> {
    // 先尝试正常停止
    let _ = shell::run_command_output("openclaw", &["gateway", "stop"]);
    
    // 等待一秒
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    // 强制杀死进程
    let _ = shell::run_command("pkill", &["-f", "openclaw.*gateway"]);
    
    // 再次检查
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    let status = get_service_status().await?;
    if status.running {
        // 强制杀死
        let _ = shell::run_command("pkill", &["-9", "-f", "openclaw.*gateway"]);
        std::thread::sleep(std::time::Duration::from_millis(500));
        
        let status = get_service_status().await?;
        if status.running {
            return Err("无法停止服务，请手动处理".to_string());
        }
    }
    
    Ok("服务已停止".to_string())
}

/// 重启服务
#[command]
pub async fn restart_service() -> Result<String, String> {
    // 先停止
    let _ = stop_service().await;
    
    // 等待端口释放
    std::thread::sleep(std::time::Duration::from_secs(2));
    
    // 再启动
    start_service().await
}

/// 获取日志
#[command]
pub async fn get_logs(lines: Option<u32>) -> Result<Vec<String>, String> {
    let log_file = platform::get_log_file_path();
    let n = lines.unwrap_or(100) as usize;
    
    file::read_last_lines(&log_file, n)
        .map_err(|e| format!("读取日志失败: {}", e))
}
