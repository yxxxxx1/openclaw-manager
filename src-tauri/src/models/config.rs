use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// OpenClaw 完整配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenClawConfig {
    /// 模型配置
    #[serde(default)]
    pub models: ModelsConfig,
    /// 网关配置
    #[serde(default)]
    pub gateway: GatewayConfig,
    /// 身份配置
    #[serde(default)]
    pub identity: IdentityConfig,
}

/// 模型配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelsConfig {
    /// 默认模型
    #[serde(default)]
    pub default: Option<String>,
    /// 自定义 Provider
    #[serde(default)]
    pub providers: HashMap<String, ProviderConfig>,
}

/// Provider 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// API 地址
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    /// API Key
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    /// 模型列表
    #[serde(default)]
    pub models: Vec<ModelInfo>,
}

/// 模型信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub api: Option<String>,
    #[serde(default)]
    pub input: Vec<String>,
    #[serde(rename = "contextWindow", default)]
    pub context_window: Option<u32>,
    #[serde(rename = "maxTokens", default)]
    pub max_tokens: Option<u32>,
}

/// 网关配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GatewayConfig {
    /// 模式：local 或 cloud
    #[serde(default)]
    pub mode: Option<String>,
    /// 端口
    #[serde(default)]
    pub port: Option<u16>,
}

/// 身份配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IdentityConfig {
    /// Bot 名称
    #[serde(default)]
    pub bot_name: Option<String>,
    /// 用户称呼
    #[serde(default)]
    pub user_name: Option<String>,
    /// 时区
    #[serde(default)]
    pub timezone: Option<String>,
}

/// AI Provider 选项（用于前端展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIProviderOption {
    /// Provider ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 图标（emoji）
    pub icon: String,
    /// 官方 API 地址
    pub default_base_url: Option<String>,
    /// 推荐模型列表
    pub models: Vec<AIModelOption>,
    /// 是否需要 API Key
    pub requires_api_key: bool,
}

/// AI 模型选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIModelOption {
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 描述
    pub description: Option<String>,
    /// 是否推荐
    pub recommended: bool,
}

/// 渠道配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelConfig {
    /// 渠道 ID
    pub id: String,
    /// 渠道类型
    pub channel_type: String,
    /// 是否启用
    pub enabled: bool,
    /// 配置详情
    pub config: HashMap<String, serde_json::Value>,
}

/// 环境变量配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvConfig {
    pub key: String,
    pub value: String,
}
