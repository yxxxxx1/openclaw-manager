import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Monitor, Package, Folder, CheckCircle, XCircle } from 'lucide-react';

interface SystemInfoData {
  os: string;
  os_version: string;
  arch: string;
  openclaw_installed: boolean;
  openclaw_version: string | null;
  node_version: string | null;
  config_dir: string;
}

export function SystemInfo() {
  const [info, setInfo] = useState<SystemInfoData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const result = await invoke<SystemInfoData>('get_system_info');
        setInfo(result);
      } catch (e) {
        console.error('获取系统信息失败:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchInfo();
  }, []);

  const getOSLabel = (os: string) => {
    switch (os) {
      case 'macos':
        return 'macOS';
      case 'windows':
        return 'Windows';
      case 'linux':
        return 'Linux';
      default:
        return os;
    }
  };

  if (loading) {
    return (
      <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
        <h3 className="text-lg font-semibold text-white mb-4">系统信息</h3>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-dark-500 rounded w-1/2"></div>
          <div className="h-4 bg-dark-500 rounded w-2/3"></div>
          <div className="h-4 bg-dark-500 rounded w-1/3"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark-700 rounded-2xl p-6 border border-dark-500">
      <h3 className="text-lg font-semibold text-white mb-4">系统信息</h3>

      <div className="space-y-4">
        {/* 操作系统 */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-dark-500 flex items-center justify-center">
            <Monitor size={16} className="text-gray-400" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500">操作系统</p>
            <p className="text-sm text-white">
              {info ? `${getOSLabel(info.os)} ${info.os_version}` : '--'}{' '}
              <span className="text-gray-500">({info?.arch})</span>
            </p>
          </div>
        </div>

        {/* OpenClaw */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-dark-500 flex items-center justify-center">
            {info?.openclaw_installed ? (
              <CheckCircle size={16} className="text-green-400" />
            ) : (
              <XCircle size={16} className="text-red-400" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500">OpenClaw</p>
            <p className="text-sm text-white">
              {info?.openclaw_installed
                ? info.openclaw_version || '已安装'
                : '未安装'}
            </p>
          </div>
        </div>

        {/* Node.js */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-dark-500 flex items-center justify-center">
            <Package size={16} className="text-green-500" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500">Node.js</p>
            <p className="text-sm text-white">{info?.node_version || '--'}</p>
          </div>
        </div>

        {/* 配置目录 */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-dark-500 flex items-center justify-center">
            <Folder size={16} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500">配置目录</p>
            <p className="text-sm text-white font-mono text-xs truncate">
              {info?.config_dir || '--'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
