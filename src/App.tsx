import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Sidebar } from './components/Layout/Sidebar';
import { Header } from './components/Layout/Header';
import { Dashboard } from './components/Dashboard';
import { Setup } from './components/Setup';
import { AIConfig } from './components/AIConfig';
import { Channels } from './components/Channels';
import { Settings } from './components/Settings';
import { Testing } from './components/Testing';
import { Logs } from './components/Logs';
import { appLogger } from './lib/logger';
import { isTauri } from './lib/tauri';
import { Download, X, Loader2, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';

export type PageType = 'dashboard' | 'ai' | 'channels' | 'testing' | 'logs' | 'settings';

export interface EnvironmentStatus {
  node_installed: boolean;
  node_version: string | null;
  node_version_ok: boolean;
  openclaw_installed: boolean;
  openclaw_version: string | null;
  config_dir_exists: boolean;
  ready: boolean;
  os: string;
}

interface ServiceStatus {
  running: boolean;
  pid: number | null;
  port: number;
}

interface UpdateInfo {
  update_available: boolean;
  current_version: string | null;
  latest_version: string | null;
  error: string | null;
}

interface UpdateResult {
  success: boolean;
  message: string;
  error?: string;
}

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>(() => {
    if (typeof window === 'undefined') {
      return 'dashboard';
    }

    const saved = window.localStorage.getItem('openclaw_last_page');
    const validPages: PageType[] = ['dashboard', 'ai', 'channels', 'testing', 'logs', 'settings'];
    return validPages.includes(saved as PageType) ? (saved as PageType) : 'dashboard';
  });
  const [configExpanded, setConfigExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem('openclaw_config_expanded') === 'true';
  });
  const [isReady, setIsReady] = useState<boolean | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvironmentStatus | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  
  // 更新相关状态
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [showWorkspaceGuide, setShowWorkspaceGuide] = useState(false);
  const [pendingGuideAfterSetup, setPendingGuideAfterSetup] = useState(false);

  // 检查环境
  const checkEnvironment = useCallback(async () => {
    if (!isTauri()) {
      appLogger.warn('不在 Tauri 环境中，跳过环境检查');
      setIsReady(true);
      return;
    }
    
    appLogger.info('开始检查系统环境...');
    try {
      const status = await invoke<EnvironmentStatus>('check_environment');
      appLogger.info('环境检查完成', status);
      setEnvStatus(status);
      setIsReady(true); // 总是显示主界面
    } catch (e) {
      appLogger.error('环境检查失败', e);
      setIsReady(true);
    }
  }, []);

  // 检查更新
  const checkUpdate = useCallback(async () => {
    if (!isTauri()) return;
    
    appLogger.info('检查 OpenClaw 更新...');
    try {
      const info = await invoke<UpdateInfo>('check_openclaw_update');
      appLogger.info('更新检查结果', info);
      setUpdateInfo(info);
      if (info.update_available) {
        setShowUpdateBanner(true);
      }
    } catch (e) {
      appLogger.error('检查更新失败', e);
    }
  }, []);

  // 执行更新
  const handleUpdate = async () => {
    setUpdating(true);
    setUpdateResult(null);
    try {
      const result = await invoke<UpdateResult>('update_openclaw');
      setUpdateResult(result);
      if (result.success) {
        // 更新成功后重新检查环境
        await checkEnvironment();
        // 3秒后关闭提示
        setTimeout(() => {
          setShowUpdateBanner(false);
          setUpdateResult(null);
        }, 3000);
      }
    } catch (e) {
      setUpdateResult({
        success: false,
        message: '更新过程中发生错误',
        error: String(e),
      });
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    appLogger.info('🦞 App 组件已挂载');
    checkEnvironment();
  }, [checkEnvironment]);

  // 启动后延迟检查更新（避免阻塞启动）
  useEffect(() => {
    if (!isTauri()) return;
    const timer = setTimeout(() => {
      checkUpdate();
    }, 2000);
    return () => clearTimeout(timer);
  }, [checkUpdate]);

  // 定期获取服务状态
  useEffect(() => {
    // 不在 Tauri 环境中则不轮询
    if (!isTauri()) return;
    
    const fetchServiceStatus = async () => {
      try {
        const status = await invoke<ServiceStatus>('get_service_status');
        setServiceStatus(status);
      } catch {
        // 静默处理轮询错误
      }
    };
    fetchServiceStatus();
    const interval = setInterval(fetchServiceStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSetupComplete = useCallback(() => {
    appLogger.info('安装向导完成');
    setCurrentPage('dashboard');
    window.localStorage.setItem('openclaw_last_page', 'dashboard');
    setPendingGuideAfterSetup(true);
    checkEnvironment(); // 重新检查环境
  }, [checkEnvironment]);

  useEffect(() => {
    if (!pendingGuideAfterSetup || !envStatus?.ready) {
      return;
    }

    const alreadySeen = window.localStorage.getItem('openclaw_workspace_guide_seen') === 'true';
    if (!alreadySeen) {
      setShowWorkspaceGuide(true);
    }
    setPendingGuideAfterSetup(false);
  }, [pendingGuideAfterSetup, envStatus]);

  // 页面切换处理
  const handleNavigate = (page: PageType) => {
    appLogger.action('页面切换', { from: currentPage, to: page });
    setCurrentPage(page);
    window.localStorage.setItem('openclaw_last_page', page);

    if (page !== 'dashboard') {
      setConfigExpanded(true);
      window.localStorage.setItem('openclaw_config_expanded', 'true');
    }
  };

  useEffect(() => {
    if (currentPage !== 'dashboard' && !configExpanded) {
      setConfigExpanded(true);
      window.localStorage.setItem('openclaw_config_expanded', 'true');
    }
  }, [currentPage, configExpanded]);

  const renderPage = () => {
    const pageVariants = {
      initial: { opacity: 0, x: 20 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: -20 },
    };

    const pages: Record<PageType, JSX.Element> = {
      dashboard: <Dashboard onNavigate={handleNavigate} />,
      ai: <AIConfig />,
      channels: <Channels />,
      testing: <Testing onNavigate={handleNavigate} />,
      logs: <Logs />,
      settings: <Settings onEnvironmentChange={checkEnvironment} />,
    };

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={currentPage}
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.2 }}
          className="h-full"
        >
          {pages[currentPage]}
        </motion.div>
      </AnimatePresence>
    );
  };

  // 正在检查环境
  if (isReady === null) {
    return (
      <div className="flex h-screen bg-dark-900 items-center justify-center">
        <div className="fixed inset-0 bg-gradient-radial pointer-events-none" />
        <div className="relative z-10 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 mb-4 animate-pulse">
            <span className="text-3xl">🦞</span>
          </div>
          <p className="text-dark-400">正在启动...</p>
        </div>
      </div>
    );
  }

  if (envStatus && !envStatus.ready) {
    return <Setup onComplete={handleSetupComplete} />;
  }

  // 主界面
  return (
    <div className="flex h-screen app-shell-bg overflow-hidden">
      {/* 背景装饰 */}
      <div className="fixed inset-0 bg-gradient-radial pointer-events-none" />
      
      {/* 更新提示横幅 */}
      <AnimatePresence>
        {showUpdateBanner && updateInfo?.update_available && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-claw-600 to-purple-600 shadow-lg"
          >
            <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {updateResult?.success ? (
                  <CheckCircle size={20} className="text-green-300" />
                ) : updateResult && !updateResult.success ? (
                  <AlertCircle size={20} className="text-red-300" />
                ) : (
                  <Download size={20} className="text-white" />
                )}
                <div>
                  {updateResult ? (
                    <p className={`text-sm font-medium ${updateResult.success ? 'text-green-100' : 'text-red-100'}`}>
                      {updateResult.message}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-white">
                        发现新版本 OpenClaw {updateInfo.latest_version}
                      </p>
                      <p className="text-xs text-white/70">
                        当前版本: {updateInfo.current_version}
                      </p>
                    </>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {!updateResult && (
                  <button
                    onClick={handleUpdate}
                    disabled={updating}
                    className="px-4 py-1.5 bg-white/20 hover:bg-white/30 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    {updating ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        更新中...
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        立即更新
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowUpdateBanner(false);
                    setUpdateResult(null);
                  }}
                  className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-white/70 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showWorkspaceGuide && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,720px)]"
          >
            <div className="premium-card rounded-2xl border border-accent-cyan/40 p-4 md:p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-accent-cyan mb-1 flex items-center gap-1">
                    <Sparkles size={14} />
                    新手引导
                  </p>
                  <h3 className="text-white font-semibold">欢迎进入 OpenClaw Studio 工作台</h3>
                  <p className="text-sm text-dark-300 mt-1">建议先完成 AI 配置和消息渠道；最终联调是可选验收步骤。</p>
                </div>
                <button
                  onClick={() => {
                    setShowWorkspaceGuide(false);
                    window.localStorage.setItem('openclaw_workspace_guide_seen', 'true');
                  }}
                  className="p-1.5 hover:bg-dark-700 rounded-lg text-dark-300 hover:text-white"
                  aria-label="关闭引导"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    setShowWorkspaceGuide(false);
                    setCurrentPage('ai');
                    setConfigExpanded(true);
                    window.localStorage.setItem('openclaw_last_page', 'ai');
                    window.localStorage.setItem('openclaw_config_expanded', 'true');
                    window.localStorage.setItem('openclaw_workspace_guide_seen', 'true');
                  }}
                  className="btn-primary py-2.5 text-sm"
                >
                  第一步：AI 配置
                </button>
                <button
                  onClick={() => {
                    setShowWorkspaceGuide(false);
                    setCurrentPage('channels');
                    setConfigExpanded(true);
                    window.localStorage.setItem('openclaw_last_page', 'channels');
                    window.localStorage.setItem('openclaw_config_expanded', 'true');
                    window.localStorage.setItem('openclaw_workspace_guide_seen', 'true');
                  }}
                  className="btn-secondary py-2.5 text-sm"
                >
                  第二步：消息渠道
                </button>
                <button
                  onClick={() => {
                    setShowWorkspaceGuide(false);
                    setCurrentPage('testing');
                    setConfigExpanded(true);
                    window.localStorage.setItem('openclaw_last_page', 'testing');
                    window.localStorage.setItem('openclaw_config_expanded', 'true');
                    window.localStorage.setItem('openclaw_workspace_guide_seen', 'true');
                  }}
                  className="btn-secondary py-2.5 text-sm"
                >
                  第三步（可选）：最终联调
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* 侧边栏 */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        serviceStatus={serviceStatus}
        configExpanded={configExpanded}
        onConfigExpandedChange={(expanded) => {
          setConfigExpanded(expanded);
          window.localStorage.setItem('openclaw_config_expanded', String(expanded));
        }}
      />
      
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 标题栏（macOS 拖拽区域） */}
        <Header currentPage={currentPage} />
        
        {/* 页面内容 */}
        <main className="flex-1 overflow-hidden p-3 pt-3">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default App;
