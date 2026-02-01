import { useState } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Play,
  Loader2,
  Zap,
  MessageCircle,
  Stethoscope,
  Hash,
  Slack,
  MessagesSquare,
} from 'lucide-react';
import clsx from 'clsx';

interface DiagnosticResult {
  name: string;
  passed: boolean;
  message: string;
  suggestion: string | null;
}

interface AITestResult {
  success: boolean;
  provider: string;
  model: string;
  response: string | null;
  error: string | null;
  latency_ms: number | null;
}

interface ChannelTestResult {
  success: boolean;
  channel: string;
  message: string;
  error: string | null;
}

// 渠道配置
const channelConfigs = [
  { id: 'telegram', name: 'Telegram', icon: <MessageCircle size={20} />, color: 'text-blue-400' },
  { id: 'discord', name: 'Discord', icon: <Hash size={20} />, color: 'text-indigo-400' },
  { id: 'whatsapp', name: 'WhatsApp', icon: <MessageCircle size={20} />, color: 'text-green-500' },
  { id: 'slack', name: 'Slack', icon: <Slack size={20} />, color: 'text-purple-400' },
  { id: 'feishu', name: '飞书', icon: <MessagesSquare size={20} />, color: 'text-blue-500' },
];

export function Testing() {
  const [diagnosticResults, setDiagnosticResults] = useState<DiagnosticResult[]>([]);
  const [aiTestResult, setAiTestResult] = useState<AITestResult | null>(null);
  const [channelResults, setChannelResults] = useState<Record<string, ChannelTestResult>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const runDiagnostics = async () => {
    setLoading('diagnostics');
    setDiagnosticResults([]);
    try {
      const results = await invoke<DiagnosticResult[]>('run_doctor');
      setDiagnosticResults(results);
    } catch (e) {
      console.error('诊断失败:', e);
      setDiagnosticResults([{
        name: '诊断执行',
        passed: false,
        message: String(e),
        suggestion: '请检查 OpenClaw 是否正确安装',
      }]);
    } finally {
      setLoading(null);
    }
  };

  const runAITest = async () => {
    setLoading('ai');
    setAiTestResult(null);
    try {
      const result = await invoke<AITestResult>('test_ai_connection');
      setAiTestResult(result);
    } catch (e) {
      console.error('AI 测试失败:', e);
      setAiTestResult({
        success: false,
        provider: 'unknown',
        model: 'unknown',
        response: null,
        error: String(e),
        latency_ms: null,
      });
    } finally {
      setLoading(null);
    }
  };

  const runChannelTest = async (channelId: string) => {
    setLoading(`channel-${channelId}`);
    
    // 清除之前的结果
    setChannelResults((prev) => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    
    try {
      const result = await invoke<ChannelTestResult>('test_channel', { 
        channelType: channelId 
      });
      setChannelResults((prev) => ({
        ...prev,
        [channelId]: result,
      }));
    } catch (e) {
      console.error(`${channelId} 测试失败:`, e);
      setChannelResults((prev) => ({
        ...prev,
        [channelId]: {
          success: false,
          channel: channelId,
          message: '测试失败',
          error: String(e),
        },
      }));
    } finally {
      setLoading(null);
    }
  };

  // 获取渠道测试状态的图标和颜色
  const getChannelStatus = (channelId: string) => {
    const result = channelResults[channelId];
    const isLoading = loading === `channel-${channelId}`;
    
    if (isLoading) {
      return {
        icon: <Loader2 size={20} className="animate-spin text-gray-400" />,
        statusText: '测试中...',
        statusColor: 'text-gray-400',
      };
    }
    
    if (!result) {
      return {
        icon: <AlertCircle size={20} className="text-gray-500" />,
        statusText: '点击测试',
        statusColor: 'text-gray-600',
      };
    }
    
    if (result.success) {
      return {
        icon: <CheckCircle size={20} className="text-green-400" />,
        statusText: '连接成功',
        statusColor: 'text-green-400',
      };
    }
    
    return {
      icon: <XCircle size={20} className="text-red-400" />,
      statusText: '连接失败',
      statusColor: 'text-red-400',
    };
  };

  return (
    <div className="h-full overflow-y-auto scroll-container pr-2">
      <div className="max-w-4xl space-y-6">
        {/* 诊断测试 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <Stethoscope size={20} className="text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">系统诊断</h3>
                <p className="text-xs text-gray-500">
                  检查 OpenClaw 安装和配置状态
                </p>
              </div>
            </div>
            <button
              onClick={runDiagnostics}
              disabled={loading === 'diagnostics'}
              className="btn-secondary flex items-center gap-2"
            >
              {loading === 'diagnostics' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              运行诊断
            </button>
          </div>

          {diagnosticResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2 mt-4"
            >
              {diagnosticResults.map((result, index) => (
                <div
                  key={index}
                  className={clsx(
                    'flex items-start gap-3 p-3 rounded-lg',
                    result.passed ? 'bg-green-500/10' : 'bg-red-500/10'
                  )}
                >
                  {result.passed ? (
                    <CheckCircle size={18} className="text-green-400 mt-0.5" />
                  ) : (
                    <XCircle size={18} className="text-red-400 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p
                      className={clsx(
                        'text-sm font-medium',
                        result.passed ? 'text-green-400' : 'text-red-400'
                      )}
                    >
                      {result.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{result.message}</p>
                    {result.suggestion && (
                      <p className="text-xs text-amber-400 mt-1">
                        💡 {result.suggestion}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </div>

        {/* AI 连接测试 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                <Zap size={20} className="text-cyan-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">AI 连接测试</h3>
                <p className="text-xs text-gray-500">
                  测试当前配置的 AI 模型连接
                </p>
              </div>
            </div>
            <button
              onClick={runAITest}
              disabled={loading === 'ai'}
              className="btn-secondary flex items-center gap-2"
            >
              {loading === 'ai' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              测试连接
            </button>
          </div>

          {aiTestResult && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={clsx(
                'p-4 rounded-xl mt-4',
                aiTestResult.success ? 'bg-green-500/10' : 'bg-red-500/10'
              )}
            >
              <div className="flex items-center gap-3 mb-3">
                {aiTestResult.success ? (
                  <CheckCircle size={24} className="text-green-400" />
                ) : (
                  <XCircle size={24} className="text-red-400" />
                )}
                <div>
                  <p
                    className={clsx(
                      'font-semibold',
                      aiTestResult.success ? 'text-green-400' : 'text-red-400'
                    )}
                  >
                    {aiTestResult.success ? '连接成功' : '连接失败'}
                  </p>
                  {aiTestResult.latency_ms && (
                    <p className="text-xs text-gray-400">
                      响应时间: {aiTestResult.latency_ms}ms
                    </p>
                  )}
                </div>
              </div>

              {aiTestResult.response && (
                <div className="mt-3 p-3 bg-dark-600 rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">AI 响应:</p>
                  <p className="text-sm text-white whitespace-pre-wrap">
                    {aiTestResult.response}
                  </p>
                </div>
              )}

              {aiTestResult.error && (
                <div className="mt-3 p-3 bg-red-500/10 rounded-lg">
                  <p className="text-xs text-red-400 mb-1">错误信息:</p>
                  <p className="text-sm text-red-300 whitespace-pre-wrap">
                    {aiTestResult.error}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* 渠道测试 */}
        <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <MessageCircle size={20} className="text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">渠道连接测试</h3>
              <p className="text-xs text-gray-500">
                测试各消息渠道的连接状态
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {channelConfigs.map((channel) => {
              const status = getChannelStatus(channel.id);
              const result = channelResults[channel.id];
              const isLoading = loading === `channel-${channel.id}`;
              
              return (
                <button
                  key={channel.id}
                  onClick={() => runChannelTest(channel.id)}
                  disabled={isLoading}
                  className={clsx(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border transition-all',
                    result?.success 
                      ? 'bg-green-500/10 border-green-500/30' 
                      : result?.error 
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-dark-600 border-dark-500 hover:border-dark-400',
                    isLoading && 'opacity-70 cursor-wait'
                  )}
                >
                  <div className={channel.color}>{channel.icon}</div>
                  {status.icon}
                  <span className="text-sm text-gray-300">{channel.name}</span>
                  <span className={clsx('text-xs', status.statusColor)}>
                    {status.statusText}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 显示渠道测试详情 */}
          {Object.entries(channelResults).map(([channelId, result]) => (
            result.error && (
              <motion.div
                key={channelId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-3 bg-red-500/10 rounded-lg"
              >
                <p className="text-xs text-red-400 mb-1">
                  {channelConfigs.find(c => c.id === channelId)?.name} 错误:
                </p>
                <p className="text-sm text-red-300 whitespace-pre-wrap">
                  {result.error}
                </p>
              </motion.div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}
