import { useState } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import {
  CheckCircle,
  XCircle,
  Play,
  Loader2,
  Stethoscope,
} from 'lucide-react';
import clsx from 'clsx';
import { testingLogger } from '../../lib/logger';
import type { PageType } from '../../App';

interface DiagnosticResult {
  name: string;
  passed: boolean;
  message: string;
  suggestion: string | null;
}

interface TestingProps {
  onNavigate?: (page: PageType) => void;
}

export function Testing({ onNavigate }: TestingProps) {
  const [diagnosticResults, setDiagnosticResults] = useState<DiagnosticResult[]>([]);
  const [loading, setLoading] = useState(false);
  const aiDone = window.localStorage.getItem('openclaw_onboarding_ai_done') === 'true';
  const channelDone = window.localStorage.getItem('openclaw_onboarding_channel_done') === 'true';

  const runDiagnostics = async () => {
    testingLogger.action('运行最终联调');
    testingLogger.info('开始最终联调检查...');
    setLoading(true);
    setDiagnosticResults([]);
    try {
      const results = await invoke<DiagnosticResult[]>('run_doctor');
      testingLogger.info(`联调完成，共 ${results.length} 项检查`);
      const passed = results.filter(r => r.passed).length;
      testingLogger.state('诊断结果', { total: results.length, passed, failed: results.length - passed });
      setDiagnosticResults(results);
      if (results.length > 0 && passed === results.length) {
        window.localStorage.setItem('openclaw_onboarding_testing_done', 'true');
      } else {
        window.localStorage.removeItem('openclaw_onboarding_testing_done');
      }
    } catch (e) {
      testingLogger.error('诊断执行失败', e);
      setDiagnosticResults([{
        name: '诊断执行',
        passed: false,
        message: String(e),
        suggestion: '请检查 OpenClaw 是否正确安装',
      }]);
      window.localStorage.removeItem('openclaw_onboarding_testing_done');
    } finally {
      setLoading(false);
    }
  };

  // 统计结果
  const passedCount = diagnosticResults.filter(r => r.passed).length;
  const failedCount = diagnosticResults.filter(r => !r.passed).length;

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
                <h3 className="text-lg font-semibold text-white">最终联调（可选）</h3>
                <p className="text-xs text-gray-500">
                  不重复做单项测试，只做一次整体可用性验收
                </p>
              </div>
            </div>
            <button
              onClick={runDiagnostics}
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              开始最终联调
            </button>
          </div>

          <div className="mb-4 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-xs text-cyan-100">
            <p>你在 AI 配置页和消息渠道页的单项测试已是主要校验手段。</p>
            <p className="mt-1">本页用于最后一步的一次性联调验收（可选，不阻塞使用）。</p>
            <p className="mt-1 text-cyan-200">
              当前步骤状态：AI {aiDone ? '已通过' : '未通过'} / 渠道 {channelDone ? '已通过' : '未通过'}
            </p>
          </div>

          {/* 诊断结果统计 */}
          {diagnosticResults.length > 0 && (
            <div className="flex gap-4 mb-4 p-3 bg-dark-600 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-green-400" />
                <span className="text-sm text-green-400">{passedCount} 项通过</span>
              </div>
              {failedCount > 0 && (
                <div className="flex items-center gap-2">
                  <XCircle size={16} className="text-red-400" />
                  <span className="text-sm text-red-400">{failedCount} 项失败</span>
                </div>
              )}
              {failedCount > 0 && onNavigate && (
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => onNavigate('ai')} className="btn-secondary py-1.5 px-3 text-xs">去 AI 配置</button>
                  <button onClick={() => onNavigate('channels')} className="btn-secondary py-1.5 px-3 text-xs">去消息渠道</button>
                </div>
              )}
            </div>
          )}

          {/* 诊断结果列表 */}
          {diagnosticResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2"
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
                    <CheckCircle size={18} className="text-green-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <XCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={clsx(
                        'text-sm font-medium',
                        result.passed ? 'text-green-400' : 'text-red-400'
                      )}
                    >
                      {result.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap break-words">{result.message}</p>
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

          {/* 空状态 */}
          {diagnosticResults.length === 0 && !loading && (
            <div className="text-center py-8 text-gray-500">
              <Stethoscope size={48} className="mx-auto mb-3 opacity-30" />
              <p>点击“开始最终联调”进行一次整体验收</p>
            </div>
          )}
        </div>

        {/* 说明 */}
        <div className="bg-dark-700/50 rounded-xl p-4 border border-dark-500">
          <h4 className="text-sm font-medium text-gray-400 mb-2">联调说明</h4>
          <ul className="text-sm text-gray-500 space-y-1">
            <li>• 本页只做整体联调，不替代 AI/渠道页面中的单项测试</li>
            <li>• AI 连接测试请在 <span className="text-claw-400">AI 配置</span> 页面完成</li>
            <li>• 渠道连通测试请在 <span className="text-claw-400">消息渠道</span> 页面完成</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
