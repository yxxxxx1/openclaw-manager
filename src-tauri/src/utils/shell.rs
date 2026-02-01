use std::process::{Command, Output};
use std::io;

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

/// 后台执行命令（不等待结果）
pub fn spawn_background(script: &str) -> io::Result<()> {
    Command::new("bash")
        .arg("-c")
        .arg(script)
        .spawn()?;
    Ok(())
}

/// 检查命令是否存在
pub fn command_exists(cmd: &str) -> bool {
    Command::new("which")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
