import { useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { api } from '../lib/tauri';

export function useService() {
  const { serviceStatus, setServiceStatus } = useAppStore();

  const fetchStatus = useCallback(async () => {
    try {
      const status = await api.getServiceStatus();
      setServiceStatus(status);
    } catch (error) {
      console.error('获取服务状态失败:', error);
    }
  }, [setServiceStatus]);

  const start = useCallback(async () => {
    try {
      await api.startService();
      await fetchStatus();
      return true;
    } catch (error) {
      console.error('启动服务失败:', error);
      throw error;
    }
  }, [fetchStatus]);

  const stop = useCallback(async () => {
    try {
      await api.stopService();
      await fetchStatus();
      return true;
    } catch (error) {
      console.error('停止服务失败:', error);
      throw error;
    }
  }, [fetchStatus]);

  const restart = useCallback(async () => {
    try {
      await api.restartService();
      await fetchStatus();
      return true;
    } catch (error) {
      console.error('重启服务失败:', error);
      throw error;
    }
  }, [fetchStatus]);

  // 自动刷新状态
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return {
    status: serviceStatus,
    isRunning: serviceStatus?.running ?? false,
    fetchStatus,
    start,
    stop,
    restart,
  };
}
