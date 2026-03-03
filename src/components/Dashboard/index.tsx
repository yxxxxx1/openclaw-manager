import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { StatusCard } from './StatusCard';
import { QuickActions } from './QuickActions';
import { SystemInfo } from './SystemInfo';
import { api, ServiceStatus, isTauri } from '../../lib/tauri';
import { Terminal, RefreshCw, ChevronDown, ChevronUp, CheckCircle2, CircleDashed, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import type { PageType } from '../../App';

interface DashboardProps {
  onNavigate: (page: PageType) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(true);
  const [guideState, setGuideState] = useState({
    aiDone: false,
    channelDone: false,
    testingDone: false,
  });
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const refreshGuideState = () => {
    setGuideState({
      aiDone: window.localStorage.getItem('openclaw_onboarding_ai_done') === 'true',
      channelDone: window.localStorage.getItem('openclaw_onboarding_channel_done') === 'true',
      testingDone: window.localStorage.getItem('openclaw_onboarding_testing_done') === 'true',
    });
  };

  const fetchStatus = async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    try {
      const result = await api.getServiceStatus();
      setStatus(result);
    } catch {
      // 静默处理
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    if (!isTauri()) return;
    try {
      const result = await invoke<string[]>('get_logs', { lines: 50 });
      setLogs(result);
    } catch {
      // 静默处理
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    refreshGuideState();
    if (!isTauri()) return;
    
    const statusInterval = setInterval(fetchStatus, 3000);
    const logsInterval = autoRefreshLogs ? setInterval(fetchLogs, 2000) : null;
    
    return () => {
      clearInterval(statusInterval);
      if (logsInterval) clearInterval(logsInterval);
    };
  }, [autoRefreshLogs]);

  useEffect(() => {
    const onFocus = () => refreshGuideState();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // 自动滚动到日志底部（仅在日志容器内部滚动，不影响页面）
  useEffect(() => {
    if (logsExpanded && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, logsExpanded]);

  const handleStart = async () => {
    if (!isTauri()) return;
    setActionLoading(true);
    try {
      await api.startService();
      await fetchStatus();
      await fetchLogs();
    } catch (e) {
      console.error('启动失败:', e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    if (!isTauri()) return;
    setActionLoading(true);
    try {
      await api.stopService();
      await fetchStatus();
      await fetchLogs();
    } catch (e) {
      console.error('停止失败:', e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestart = async () => {
    if (!isTauri()) return;
    setActionLoading(true);
    try {
      await api.restartService();
      await fetchStatus();
      await fetchLogs();
    } catch (e) {
      console.error('重启失败:', e);
    } finally {
      setActionLoading(false);
    }
  };

  const getLogLineClass = (line: string) => {
    if (line.includes('error') || line.includes('Error') || line.includes('ERROR')) {
      return 'text-red-400';
    }
    if (line.includes('warn') || line.includes('Warn') || line.includes('WARN')) {
      return 'text-yellow-400';
    }
    if (line.includes('info') || line.includes('Info') || line.includes('INFO')) {
      return 'text-green-400';
    }
    return 'text-gray-400';
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  const requiredDoneCount = [guideState.aiDone, guideState.channelDone].filter(Boolean).length;
  const requiredAllDone = guideState.aiDone && guideState.channelDone;

  return (
    <div className="h-full overflow-y-auto scroll-container pr-2">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="space-y-6"
      >
        {/* 服务状态卡片 */}
        <motion.div variants={itemVariants}>
          <StatusCard status={status} loading={loading} />
        </motion.div>

        {/* 快捷操作 */}
        <motion.div variants={itemVariants}>
          <div className="premium-card rounded-2xl p-6 border border-accent-cyan/20">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <p className="section-title mb-1">首次配置</p>
                <h3 className="text-lg font-semibold text-white">推荐按顺序完成</h3>
              </div>
              <span className="text-xs text-dark-300">
                {requiredDoneCount}/2 必选已完成
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { key: 'ai', title: 'AI 配置', done: guideState.aiDone, page: 'ai' as PageType },
                { key: 'channel', title: '消息渠道', done: guideState.channelDone, page: 'channels' as PageType },
                { key: 'testing', title: '最终联调（可选）', done: guideState.testingDone, page: 'testing' as PageType, optional: true },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => onNavigate(item.page)}
                  className="text-left rounded-xl border border-dark-500 bg-dark-700/60 hover:border-accent-cyan/40 transition-colors p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-white">{item.title}</p>
                    {item.done ? (
                      <CheckCircle2 size={16} className="text-green-400" />
                    ) : (
                      <CircleDashed size={16} className="text-dark-300" />
                    )}
                  </div>
                  <p className={clsx('text-xs', item.done ? 'text-green-300' : 'text-dark-300')}>
                    {item.done
                      ? '已完成，可随时调整'
                      : item.optional
                        ? '可选步骤：用于一次性验收，不做也可先使用'
                        : '尚未完成，点击继续'}
                  </p>
                </button>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              {requiredAllDone && !guideState.testingDone && (
                <button
                  onClick={() => onNavigate('testing')}
                  className="btn-secondary py-2 px-3 text-sm"
                >
                  可选：做一次最终联调
                </button>
              )}
              <button
                onClick={() => {
                  if (!guideState.aiDone) return onNavigate('ai');
                  if (!guideState.channelDone) return onNavigate('channels');
                  return onNavigate('dashboard');
                }}
                className="btn-primary py-2 px-3 text-sm flex items-center gap-2"
              >
                {!guideState.aiDone
                  ? '下一步：AI 配置'
                  : !guideState.channelDone
                    ? '下一步：消息渠道'
                    : '已完成初始化'}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants}>
          <QuickActions
            status={status}
            loading={actionLoading}
            onStart={handleStart}
            onStop={handleStop}
            onRestart={handleRestart}
            onOpenTesting={() => onNavigate('testing')}
          />
        </motion.div>

        {/* 实时日志 */}
        <motion.div variants={itemVariants}>
          <div className="premium-card rounded-2xl overflow-hidden">
            {/* 日志标题栏 */}
            <div 
              className="flex items-center justify-between px-4 py-3 bg-dark-700/40 border-b soft-divider cursor-pointer"
              onClick={() => setLogsExpanded(!logsExpanded)}
            >
              <div className="flex items-center gap-2">
                <Terminal size={16} className="text-gray-500" />
                <span className="text-sm font-medium text-white">实时日志</span>
                <span className="text-xs text-gray-500">
                  ({logs.length} 行)
                </span>
              </div>
              <div className="flex items-center gap-3">
                {logsExpanded && (
                  <>
                    <label 
                      className="flex items-center gap-2 text-xs text-gray-400"
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={autoRefreshLogs}
                        onChange={(e) => setAutoRefreshLogs(e.target.checked)}
                        className="w-3 h-3 rounded border-dark-500 bg-dark-600 text-claw-500"
                      />
                      自动刷新
                    </label>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchLogs();
                      }}
                      className="text-gray-500 hover:text-white"
                      title="刷新日志"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </>
                )}
                {logsExpanded ? (
                  <ChevronUp size={16} className="text-gray-500" />
                ) : (
                  <ChevronDown size={16} className="text-gray-500" />
                )}
              </div>
            </div>

            {/* 日志内容 */}
            {logsExpanded && (
              <div ref={logsContainerRef} className="h-64 overflow-y-auto p-4 font-mono text-xs leading-relaxed bg-dark-800/80">
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    <p>暂无日志，请先启动服务</p>
                  </div>
                ) : (
                  <>
                    {logs.map((line, index) => (
                      <div
                        key={index}
                        className={clsx('py-0.5 whitespace-pre-wrap break-all', getLogLineClass(line))}
                      >
                        {line}
                      </div>
                    ))}

                  </>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* 系统信息 */}
        <motion.div variants={itemVariants}>
          <SystemInfo />
        </motion.div>
      </motion.div>
    </div>
  );
}
