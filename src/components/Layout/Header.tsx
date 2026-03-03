import { useState } from 'react';
import { PageType } from '../../App';
import { RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';

interface HeaderProps {
  currentPage: PageType;
}

const pageTitles: Record<PageType, { title: string; description: string }> = {
  dashboard: { title: '概览', description: '服务状态、日志与快捷操作' },
  ai: { title: 'AI 模型配置', description: '配置 AI 提供商和模型' },
  channels: { title: '消息渠道', description: '配置 Telegram、Discord、飞书等' },
  testing: { title: '测试诊断', description: '系统诊断与问题排查' },
  logs: { title: '应用日志', description: '查看 Studio 应用的控制台日志' },
  settings: { title: '设置', description: '身份配置与高级选项' },
};

export function Header({ currentPage }: HeaderProps) {
  const { title, description } = pageTitles[currentPage];
  const [opening, setOpening] = useState(false);

  const handleOpenDashboard = async () => {
    setOpening(true);
    try {
      // 获取带 token 的 Dashboard URL（如果没有 token 会自动生成）
      const url = await invoke<string>('get_dashboard_url');
      await open(url);
    } catch (e) {
      console.error('打开 Dashboard 失败:', e);
      // 降级方案：使用 window.open（不带 token）
      window.open('http://localhost:18789', '_blank');
    } finally {
      setOpening(false);
    }
  };

  return (
    <header className="h-16 premium-card border-b soft-divider flex items-center justify-between px-6 titlebar-drag rounded-2xl m-3 mb-0 backdrop-blur-sm">
      {/* 左侧：页面标题 */}
      <div className="titlebar-no-drag">
        <p className="section-title mb-1">控制中心</p>
        <h2 className="text-lg font-semibold text-white leading-tight">{title}</h2>
        <p className="text-xs text-gray-400">{description}</p>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2 titlebar-no-drag">
        <button
          onClick={() => window.location.reload()}
          className="icon-button text-gray-300 hover:text-white border border-transparent hover:border-dark-400"
          title="刷新"
        >
          <RefreshCw size={16} />
        </button>
        <button
          onClick={handleOpenDashboard}
          disabled={opening}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-claw-500/20 border border-cyan-500/30 text-sm text-cyan-100 hover:text-white transition-colors disabled:opacity-50"
          title="打开 Web Dashboard"
        >
          {opening ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
          <span>Dashboard</span>
        </button>
      </div>
    </header>
  );
}
