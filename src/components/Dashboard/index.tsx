import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { StatusCard } from './StatusCard';
import { QuickActions } from './QuickActions';
import { SystemInfo } from './SystemInfo';
import { api, ServiceStatus, isTauri } from '../../lib/tauri';

export function Dashboard() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

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

  useEffect(() => {
    fetchStatus();
    if (!isTauri()) return;
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    if (!isTauri()) return;
    setActionLoading(true);
    try {
      await api.startService();
      await fetchStatus();
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
    } catch (e) {
      console.error('重启失败:', e);
    } finally {
      setActionLoading(false);
    }
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
          <QuickActions
            status={status}
            loading={actionLoading}
            onStart={handleStart}
            onStop={handleStop}
            onRestart={handleRestart}
          />
        </motion.div>

        {/* 系统信息 */}
        <motion.div variants={itemVariants}>
          <SystemInfo />
        </motion.div>
      </motion.div>
    </div>
  );
}
