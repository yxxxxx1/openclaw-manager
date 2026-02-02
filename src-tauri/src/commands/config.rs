use crate::models::{AIModelOption, AIProviderOption, ChannelConfig};
use crate::utils::{file, platform};
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::command;
use log::{info, warn, error, debug};

/// 获取 openclaw.json 配置
fn load_openclaw_config() -> Result<Value, String> {
    let config_path = platform::get_config_file_path();
    
    if !file::file_exists(&config_path) {
        return Ok(json!({}));
    }
    
    let content = file::read_file(&config_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;
    
    serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件失败: {}", e))
}

/// 保存 openclaw.json 配置
fn save_openclaw_config(config: &Value) -> Result<(), String> {
    let config_path = platform::get_config_file_path();
    
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    
    file::write_file(&config_path, &content)
        .map_err(|e| format!("写入配置文件失败: {}", e))
}

/// 获取完整配置
#[command]
pub async fn get_config() -> Result<Value, String> {
    info!("[获取配置] 读取 openclaw.json 配置...");
    let result = load_openclaw_config();
    match &result {
        Ok(_) => info!("[获取配置] ✓ 配置读取成功"),
        Err(e) => error!("[获取配置] ✗ 配置读取失败: {}", e),
    }
    result
}

/// 保存配置
#[command]
pub async fn save_config(config: Value) -> Result<String, String> {
    info!("[保存配置] 保存 openclaw.json 配置...");
    debug!("[保存配置] 配置内容: {}", serde_json::to_string_pretty(&config).unwrap_or_default());
    match save_openclaw_config(&config) {
        Ok(_) => {
            info!("[保存配置] ✓ 配置保存成功");
            Ok("配置已保存".to_string())
        }
        Err(e) => {
            error!("[保存配置] ✗ 配置保存失败: {}", e);
            Err(e)
        }
    }
}

/// 获取环境变量值
#[command]
pub async fn get_env_value(key: String) -> Result<Option<String>, String> {
    info!("[获取环境变量] 读取环境变量: {}", key);
    let env_path = platform::get_env_file_path();
    let value = file::read_env_value(&env_path, &key);
    match &value {
        Some(v) => debug!("[获取环境变量] {}={} (已脱敏)", key, if v.len() > 8 { "***" } else { v }),
        None => debug!("[获取环境变量] {} 不存在", key),
    }
    Ok(value)
}

/// 保存环境变量值
#[command]
pub async fn save_env_value(key: String, value: String) -> Result<String, String> {
    info!("[保存环境变量] 保存环境变量: {}", key);
    let env_path = platform::get_env_file_path();
    debug!("[保存环境变量] 环境文件路径: {}", env_path);
    
    match file::set_env_value(&env_path, &key, &value) {
        Ok(_) => {
            info!("[保存环境变量] ✓ 环境变量 {} 保存成功", key);
            Ok("环境变量已保存".to_string())
        }
        Err(e) => {
            error!("[保存环境变量] ✗ 保存失败: {}", e);
            Err(format!("保存环境变量失败: {}", e))
        }
    }
}

/// 获取所有支持的 AI Provider
#[command]
pub async fn get_ai_providers() -> Result<Vec<AIProviderOption>, String> {
    info!("[AI Provider] 获取支持的 AI Provider 列表...");
    let providers = vec![
        AIProviderOption {
            id: "anthropic".to_string(),
            name: "Anthropic Claude".to_string(),
            icon: "🟣".to_string(),
            default_base_url: Some("https://api.anthropic.com".to_string()),
            requires_api_key: true,
            models: vec![
                AIModelOption {
                    id: "claude-sonnet-4-5-20250929".to_string(),
                    name: "Claude Sonnet 4.5".to_string(),
                    description: Some("最新平衡版本，推荐使用".to_string()),
                    recommended: true,
                },
                AIModelOption {
                    id: "claude-opus-4-5-20251101".to_string(),
                    name: "Claude Opus 4.5".to_string(),
                    description: Some("最强大版本".to_string()),
                    recommended: false,
                },
                AIModelOption {
                    id: "claude-haiku-4-5-20251001".to_string(),
                    name: "Claude Haiku 4.5".to_string(),
                    description: Some("快速经济版本".to_string()),
                    recommended: false,
                },
            ],
        },
        AIProviderOption {
            id: "openai".to_string(),
            name: "OpenAI GPT".to_string(),
            icon: "🟢".to_string(),
            default_base_url: Some("https://api.openai.com/v1".to_string()),
            requires_api_key: true,
            models: vec![
                AIModelOption {
                    id: "gpt-4o".to_string(),
                    name: "GPT-4o".to_string(),
                    description: Some("最新多模态模型".to_string()),
                    recommended: true,
                },
                AIModelOption {
                    id: "gpt-4o-mini".to_string(),
                    name: "GPT-4o Mini".to_string(),
                    description: Some("经济实惠版本".to_string()),
                    recommended: false,
                },
                AIModelOption {
                    id: "gpt-4-turbo".to_string(),
                    name: "GPT-4 Turbo".to_string(),
                    description: Some("高性能版本".to_string()),
                    recommended: false,
                },
            ],
        },
        AIProviderOption {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            icon: "🔵".to_string(),
            default_base_url: Some("https://api.deepseek.com".to_string()),
            requires_api_key: true,
            models: vec![
                AIModelOption {
                    id: "deepseek-chat".to_string(),
                    name: "DeepSeek V3".to_string(),
                    description: Some("最新对话模型".to_string()),
                    recommended: true,
                },
                AIModelOption {
                    id: "deepseek-reasoner".to_string(),
                    name: "DeepSeek R1".to_string(),
                    description: Some("推理增强模型".to_string()),
                    recommended: false,
                },
            ],
        },
        AIProviderOption {
            id: "kimi".to_string(),
            name: "Kimi (Moonshot)".to_string(),
            icon: "🌙".to_string(),
            default_base_url: Some("https://api.moonshot.cn/v1".to_string()),
            requires_api_key: true,
            models: vec![
                AIModelOption {
                    id: "moonshot-v1-auto".to_string(),
                    name: "Moonshot Auto".to_string(),
                    description: Some("自动选择最佳上下文".to_string()),
                    recommended: true,
                },
                AIModelOption {
                    id: "moonshot-v1-128k".to_string(),
                    name: "Moonshot 128K".to_string(),
                    description: Some("超长上下文".to_string()),
                    recommended: false,
                },
            ],
        },
        AIProviderOption {
            id: "google".to_string(),
            name: "Google Gemini".to_string(),
            icon: "🔴".to_string(),
            default_base_url: None,
            requires_api_key: true,
            models: vec![
                AIModelOption {
                    id: "gemini-2.0-flash".to_string(),
                    name: "Gemini 2.0 Flash".to_string(),
                    description: Some("最新快速模型".to_string()),
                    recommended: true,
                },
                AIModelOption {
                    id: "gemini-1.5-pro".to_string(),
                    name: "Gemini 1.5 Pro".to_string(),
                    description: Some("专业版本".to_string()),
                    recommended: false,
                },
            ],
        },
        AIProviderOption {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            icon: "🔄".to_string(),
            default_base_url: Some("https://openrouter.ai/api/v1".to_string()),
            requires_api_key: true,
            models: vec![
                AIModelOption {
                    id: "anthropic/claude-sonnet-4".to_string(),
                    name: "Claude Sonnet 4".to_string(),
                    description: Some("通过 OpenRouter 访问".to_string()),
                    recommended: true,
                },
                AIModelOption {
                    id: "openai/gpt-4o".to_string(),
                    name: "GPT-4o".to_string(),
                    description: Some("通过 OpenRouter 访问".to_string()),
                    recommended: false,
                },
            ],
        },
        AIProviderOption {
            id: "groq".to_string(),
            name: "Groq".to_string(),
            icon: "⚡".to_string(),
            default_base_url: Some("https://api.groq.com/openai/v1".to_string()),
            requires_api_key: true,
            models: vec![
                AIModelOption {
                    id: "llama-3.3-70b-versatile".to_string(),
                    name: "Llama 3.3 70B".to_string(),
                    description: Some("超快推理".to_string()),
                    recommended: true,
                },
            ],
        },
        AIProviderOption {
            id: "ollama".to_string(),
            name: "Ollama (本地)".to_string(),
            icon: "🟠".to_string(),
            default_base_url: Some("http://localhost:11434".to_string()),
            requires_api_key: false,
            models: vec![
                AIModelOption {
                    id: "llama3".to_string(),
                    name: "Llama 3".to_string(),
                    description: Some("本地运行".to_string()),
                    recommended: true,
                },
                AIModelOption {
                    id: "mistral".to_string(),
                    name: "Mistral".to_string(),
                    description: Some("本地运行".to_string()),
                    recommended: false,
                },
            ],
        },
    ];
    info!("[AI Provider] ✓ 返回 {} 个 Provider", providers.len());
    Ok(providers)
}

/// 获取渠道配置 - 从 openclaw.json 和 env 文件读取
#[command]
pub async fn get_channels_config() -> Result<Vec<ChannelConfig>, String> {
    info!("[渠道配置] 获取渠道配置列表...");
    
    let config = load_openclaw_config()?;
    let channels_obj = config.get("channels").cloned().unwrap_or(json!({}));
    let env_path = platform::get_env_file_path();
    debug!("[渠道配置] 环境文件路径: {}", env_path);
    
    let mut channels = Vec::new();
    
    // 支持的渠道类型列表及其测试字段
    let channel_types = vec![
        ("telegram", "telegram", vec!["userId"]),
        ("discord", "discord", vec!["testChannelId"]),
        ("slack", "slack", vec!["testChannelId"]),
        ("feishu", "feishu", vec!["testChatId"]),
        ("whatsapp", "whatsapp", vec![]),
        ("imessage", "imessage", vec![]),
        ("wechat", "wechat", vec![]),
        ("dingtalk", "dingtalk", vec![]),
    ];
    
    for (channel_id, channel_type, test_fields) in channel_types {
        let channel_config = channels_obj.get(channel_id);
        
        let enabled = channel_config
            .and_then(|c| c.get("enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        
        // 将渠道配置转换为 HashMap
        let mut config_map: HashMap<String, Value> = if let Some(cfg) = channel_config {
            if let Some(obj) = cfg.as_object() {
                obj.iter()
                    .filter(|(k, _)| *k != "enabled") // 排除 enabled 字段
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };
        
        // 从 env 文件读取测试字段
        for field in test_fields {
            let env_key = format!("OPENCLAW_{}_{}", channel_id.to_uppercase(), field.to_uppercase());
            if let Some(value) = file::read_env_value(&env_path, &env_key) {
                config_map.insert(field.to_string(), json!(value));
            }
        }
        
        // 判断是否已配置（有任何非空配置项）
        let has_config = !config_map.is_empty() || enabled;
        
        channels.push(ChannelConfig {
            id: channel_id.to_string(),
            channel_type: channel_type.to_string(),
            enabled: has_config,
            config: config_map,
        });
    }
    
    info!("[渠道配置] ✓ 返回 {} 个渠道配置", channels.len());
    for ch in &channels {
        debug!("[渠道配置] - {}: enabled={}", ch.id, ch.enabled);
    }
    Ok(channels)
}

/// 保存渠道配置 - 保存到 openclaw.json
/// 注意：某些字段（如 userId, testChatId 等）只用于测试，保存到 env 文件
#[command]
pub async fn save_channel_config(channel: ChannelConfig) -> Result<String, String> {
    info!("[保存渠道配置] 保存渠道配置: {} ({})", channel.id, channel.channel_type);
    
    let mut config = load_openclaw_config()?;
    let env_path = platform::get_env_file_path();
    debug!("[保存渠道配置] 环境文件路径: {}", env_path);
    
    // 确保 channels 对象存在
    if config.get("channels").is_none() {
        config["channels"] = json!({});
    }
    
    // 确保 plugins 对象存在
    if config.get("plugins").is_none() {
        config["plugins"] = json!({
            "allow": [],
            "entries": {}
        });
    }
    if config["plugins"].get("allow").is_none() {
        config["plugins"]["allow"] = json!([]);
    }
    if config["plugins"].get("entries").is_none() {
        config["plugins"]["entries"] = json!({});
    }
    
    // 这些字段只用于测试，不保存到 openclaw.json，而是保存到 env 文件
    let test_only_fields = vec!["userId", "testChatId", "testChannelId"];
    
    // 构建渠道配置
    let mut channel_obj = json!({
        "enabled": true
    });
    
    // 添加渠道特定配置
    for (key, value) in &channel.config {
        if test_only_fields.contains(&key.as_str()) {
            // 保存到 env 文件
            let env_key = format!("OPENCLAW_{}_{}", channel.id.to_uppercase(), key.to_uppercase());
            if let Some(val_str) = value.as_str() {
                let _ = file::set_env_value(&env_path, &env_key, val_str);
            }
        } else {
            // 保存到 openclaw.json
            channel_obj[key] = value.clone();
        }
    }
    
    // 更新 channels 配置
    config["channels"][&channel.id] = channel_obj;
    
    // 更新 plugins.allow 数组 - 确保渠道在白名单中
    if let Some(allow_arr) = config["plugins"]["allow"].as_array_mut() {
        let channel_id_val = json!(&channel.id);
        if !allow_arr.contains(&channel_id_val) {
            allow_arr.push(channel_id_val);
        }
    }
    
    // 更新 plugins.entries - 确保插件已启用
    config["plugins"]["entries"][&channel.id] = json!({
        "enabled": true
    });
    
    // 保存配置
    info!("[保存渠道配置] 写入配置文件...");
    match save_openclaw_config(&config) {
        Ok(_) => {
            info!("[保存渠道配置] ✓ {} 配置保存成功", channel.channel_type);
            Ok(format!("{} 配置已保存", channel.channel_type))
        }
        Err(e) => {
            error!("[保存渠道配置] ✗ 保存失败: {}", e);
            Err(e)
        }
    }
}
