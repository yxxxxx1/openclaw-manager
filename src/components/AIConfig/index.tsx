import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Check, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { aiLogger } from '../../lib/logger';

interface AIModelOption {
  id: string;
  name: string;
  description: string | null;
  recommended: boolean;
}

interface AIProviderOption {
  id: string;
  name: string;
  icon: string;
  default_base_url: string | null;
  models: AIModelOption[];
  requires_api_key: boolean;
}

// 环境变量 Key 映射
const ENV_KEY_MAP: Record<string, { apiKey: string; baseUrl: string }> = {
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', baseUrl: 'ANTHROPIC_BASE_URL' },
  openai: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  deepseek: { apiKey: 'DEEPSEEK_API_KEY', baseUrl: 'DEEPSEEK_BASE_URL' },
  kimi: { apiKey: 'MOONSHOT_API_KEY', baseUrl: 'MOONSHOT_BASE_URL' },
  google: { apiKey: 'GOOGLE_API_KEY', baseUrl: 'GOOGLE_BASE_URL' },
  openrouter: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  groq: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  ollama: { apiKey: 'OLLAMA_HOST', baseUrl: 'OLLAMA_HOST' },
};

export function AIConfig() {
  const [providers, setProviders] = useState<AIProviderOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // 存储已保存的配置
  const [savedConfigs, setSavedConfigs] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});

  // 加载所有 provider 的已保存配置
  const loadSavedConfigs = async () => {
    const configs: Record<string, { apiKey: string; baseUrl: string }> = {};
    
    for (const [providerId, keys] of Object.entries(ENV_KEY_MAP)) {
      try {
        const savedApiKey = await invoke<string | null>('get_env_value', { key: keys.apiKey });
        const savedBaseUrl = await invoke<string | null>('get_env_value', { key: keys.baseUrl });
        
        configs[providerId] = {
          apiKey: savedApiKey || '',
          baseUrl: savedBaseUrl || '',
        };
      } catch (e) {
        configs[providerId] = { apiKey: '', baseUrl: '' };
      }
    }
    
    setSavedConfigs(configs);
    return configs;
  };

  useEffect(() => {
    const init = async () => {
      aiLogger.info('AIConfig 组件初始化...');
      try {
        // 获取 Provider 列表
        aiLogger.debug('获取 AI Provider 列表...');
        const result = await invoke<AIProviderOption[]>('get_ai_providers');
        aiLogger.info(`加载了 ${result.length} 个 AI Provider`);
        setProviders(result);
        
        // 加载已保存的配置
        aiLogger.debug('加载已保存的配置...');
        const configs = await loadSavedConfigs();
        
        // 自动选择已配置的 provider
        for (const [providerId, config] of Object.entries(configs)) {
          if (config.apiKey) {
            aiLogger.info(`检测到已配置的 Provider: ${providerId}`);
            setSelectedProvider(providerId);
            setApiKey(config.apiKey);
            setBaseUrl(config.baseUrl);
            
            // 设置默认模型
            const provider = result.find((p) => p.id === providerId);
            if (provider) {
              const recommended = provider.models.find((m) => m.recommended);
              const modelId = recommended?.id || provider.models[0]?.id || '';
              setSelectedModel(modelId);
              aiLogger.debug(`设置默认模型: ${modelId}`);
            }
            break;
          }
        }
      } catch (e) {
        aiLogger.error('初始化失败', e);
      } finally {
        setLoading(false);
      }
    };
    
    init();
  }, []);

  const currentProvider = providers.find((p) => p.id === selectedProvider);

  const handleProviderSelect = (providerId: string) => {
    aiLogger.action('选择 Provider', { providerId });
    setSelectedProvider(providerId);
    const provider = providers.find((p) => p.id === providerId);
    
    if (provider) {
      // 优先使用已保存的配置
      const saved = savedConfigs[providerId];
      if (saved?.apiKey) {
        aiLogger.debug('使用已保存的配置');
        setApiKey(saved.apiKey);
        setBaseUrl(saved.baseUrl);
      } else {
        // 没有保存的配置时，清空并使用默认值作为 placeholder
        aiLogger.debug('无已保存配置，使用默认值');
        setApiKey('');
        setBaseUrl('');
      }
      
      // 设置推荐模型
      const recommended = provider.models.find((m) => m.recommended);
      const modelId = recommended?.id || provider.models[0]?.id || '';
      setSelectedModel(modelId);
      aiLogger.debug(`设置模型: ${modelId}`);
    }
  };

  const handleSave = async () => {
    if (!selectedProvider || !selectedModel) return;
    
    aiLogger.action('保存 AI 配置', { provider: selectedProvider, model: selectedModel });
    aiLogger.info('正在保存配置...');
    setSaving(true);
    try {
      const keys = ENV_KEY_MAP[selectedProvider];
      
      // 保存 API Key
      if (apiKey) {
        aiLogger.debug(`保存 API Key: ${keys.apiKey}`);
        await invoke('save_env_value', { key: keys.apiKey, value: apiKey });
      }
      
      // 保存 Base URL（即使是空的也保存，以便清除旧配置）
      aiLogger.debug(`保存 Base URL: ${keys.baseUrl}`);
      await invoke('save_env_value', { key: keys.baseUrl, value: baseUrl });
      
      // 更新本地缓存
      setSavedConfigs((prev) => ({
        ...prev,
        [selectedProvider]: { apiKey, baseUrl },
      }));
      
      aiLogger.info('✅ 配置保存成功');
      alert('配置已保存！请重启服务使配置生效。');
    } catch (e) {
      aiLogger.error('❌ 保存配置失败', e);
      alert('保存失败: ' + e);
    } finally {
      setSaving(false);
    }
  };

  // 重置为默认地址
  const handleResetBaseUrl = () => {
    if (currentProvider) {
      setBaseUrl('');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-claw-500" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-container pr-2">
      <div className="max-w-4xl space-y-6">
        {/* Provider 选择 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <h3 className="text-lg font-semibold text-white mb-4">
            选择 AI 提供商
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {providers.map((provider) => {
              const hasSavedConfig = !!savedConfigs[provider.id]?.apiKey;
              
              return (
                <button
                  key={provider.id}
                  onClick={() => handleProviderSelect(provider.id)}
                  className={clsx(
                    'relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all',
                    selectedProvider === provider.id
                      ? 'bg-claw-500/20 border-claw-500 text-white'
                      : 'bg-dark-600 border-dark-500 text-gray-400 hover:border-dark-400'
                  )}
                >
                  <span className="text-2xl">{provider.icon}</span>
                  <span className="text-sm font-medium">{provider.name}</span>
                  
                  {/* 已配置指示器 */}
                  {hasSavedConfig && (
                    <div className="absolute top-2 right-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" title="已配置" />
                    </div>
                  )}
                  
                  {selectedProvider === provider.id && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute bottom-2 right-2"
                    >
                      <Check size={14} className="text-claw-400" />
                    </motion.div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 配置表单 */}
        {currentProvider && (
          <motion.div
            key={selectedProvider}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-dark-700 rounded-2xl p-6 border border-dark-500"
          >
            <h3 className="text-lg font-semibold text-white mb-4">
              配置 {currentProvider.name}
            </h3>

            <div className="space-y-4">
              {/* API Key */}
              {currentProvider.requires_api_key && (
                <div>
                  <label className="block text-sm text-gray-400 mb-2">
                    API Key
                    {savedConfigs[currentProvider.id]?.apiKey && (
                      <span className="ml-2 text-green-500 text-xs">✓ 已配置</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="输入 API Key"
                      className="input-base pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Base URL */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  API 地址
                  {savedConfigs[currentProvider.id]?.baseUrl ? (
                    <span className="ml-2 text-cyan-400 text-xs">✓ 自定义地址</span>
                  ) : (
                    <span className="text-gray-600 ml-2">(留空使用官方地址)</span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={currentProvider.default_base_url || '输入自定义 API 地址'}
                    className="input-base pr-10"
                  />
                  {baseUrl && (
                    <button
                      type="button"
                      onClick={handleResetBaseUrl}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                      title="重置为默认地址"
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                </div>
                {/* 当前生效的地址 */}
                <p className="text-xs text-gray-500 mt-1">
                  当前地址: {baseUrl || currentProvider.default_base_url || '(使用 SDK 默认)'}
                </p>
              </div>

              {/* 模型选择 */}
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  选择模型
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {currentProvider.models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => setSelectedModel(model.id)}
                      className={clsx(
                        'flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                        selectedModel === model.id
                          ? 'bg-claw-500/20 border-claw-500'
                          : 'bg-dark-600 border-dark-500 hover:border-dark-400'
                      )}
                    >
                      <div>
                        <p
                          className={clsx(
                            'text-sm font-medium',
                            selectedModel === model.id
                              ? 'text-white'
                              : 'text-gray-300'
                          )}
                        >
                          {model.name}
                          {model.recommended && (
                            <span className="ml-2 text-xs text-claw-400">
                              推荐
                            </span>
                          )}
                        </p>
                        {model.description && (
                          <p className="text-xs text-gray-500 mt-1">
                            {model.description}
                          </p>
                        )}
                      </div>
                      {selectedModel === model.id && (
                        <Check size={16} className="text-claw-400" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* 保存按钮 */}
              <div className="pt-4 border-t border-dark-500 flex items-center justify-between">
                <button
                  onClick={handleSave}
                  disabled={saving || (!apiKey && currentProvider.requires_api_key)}
                  className="btn-primary flex items-center gap-2"
                >
                  {saving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Check size={16} />
                  )}
                  保存配置
                </button>
                
                {savedConfigs[currentProvider.id]?.apiKey && (
                  <span className="text-xs text-gray-500">
                    上次保存的配置会自动加载
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
