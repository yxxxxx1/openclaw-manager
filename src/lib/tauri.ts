import { invoke } from '@tauri-apps/api/core';

// 服务状态
export interface ServiceStatus {
  running: boolean;
  pid: number | null;
  port: number;
  uptime_seconds: number | null;
  memory_mb: number | null;
  cpu_percent: number | null;
}

// 系统信息
export interface SystemInfo {
  os: string;
  os_version: string;
  arch: string;
  openclaw_installed: boolean;
  openclaw_version: string | null;
  node_version: string | null;
  config_dir: string;
}

// AI Provider 选项
export interface AIProviderOption {
  id: string;
  name: string;
  icon: string;
  default_base_url: string | null;
  models: AIModelOption[];
  requires_api_key: boolean;
}

export interface AIModelOption {
  id: string;
  name: string;
  description: string | null;
  recommended: boolean;
}

// 渠道配置
export interface ChannelConfig {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// 诊断结果
export interface DiagnosticResult {
  name: string;
  passed: boolean;
  message: string;
  suggestion: string | null;
}

// AI 测试结果
export interface AITestResult {
  success: boolean;
  provider: string;
  model: string;
  response: string | null;
  error: string | null;
  latency_ms: number | null;
}

// API 封装
export const api = {
  // 服务管理
  getServiceStatus: () => invoke<ServiceStatus>('get_service_status'),
  startService: () => invoke<string>('start_service'),
  stopService: () => invoke<string>('stop_service'),
  restartService: () => invoke<string>('restart_service'),
  getLogs: (lines?: number) => invoke<string[]>('get_logs', { lines }),

  // 系统信息
  getSystemInfo: () => invoke<SystemInfo>('get_system_info'),
  checkOpenclawInstalled: () => invoke<boolean>('check_openclaw_installed'),
  getOpenclawVersion: () => invoke<string | null>('get_openclaw_version'),

  // 配置管理
  getConfig: () => invoke<unknown>('get_config'),
  saveConfig: (config: unknown) => invoke<string>('save_config', { config }),
  getEnvValue: (key: string) => invoke<string | null>('get_env_value', { key }),
  saveEnvValue: (key: string, value: string) =>
    invoke<string>('save_env_value', { key, value }),

  // AI Provider
  getAIProviders: () => invoke<AIProviderOption[]>('get_ai_providers'),

  // 渠道
  getChannelsConfig: () => invoke<ChannelConfig[]>('get_channels_config'),
  saveChannelConfig: (channel: ChannelConfig) =>
    invoke<string>('save_channel_config', { channel }),

  // 诊断测试
  runDoctor: () => invoke<DiagnosticResult[]>('run_doctor'),
  testAIConnection: () => invoke<AITestResult>('test_ai_connection'),
  testChannel: (channelType: string) =>
    invoke<unknown>('test_channel', { channelType }),
};
