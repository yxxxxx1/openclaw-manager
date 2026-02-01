import { PageType } from '../../App';
import { RefreshCw, ExternalLink } from 'lucide-react';

interface HeaderProps {
  currentPage: PageType;
}

const pageTitles: Record<PageType, { title: string; description: string }> = {
  dashboard: { title: '概览', description: '服务状态与快捷操作' },
  ai: { title: 'AI 模型配置', description: '配置 AI 提供商和模型' },
  channels: { title: '消息渠道', description: '配置 Telegram、Discord、飞书等' },
  service: { title: '服务管理', description: '启动、停止、查看日志' },
  testing: { title: '测试诊断', description: '连接测试与问题诊断' },
  settings: { title: '设置', description: '身份配置与高级选项' },
};

export function Header({ currentPage }: HeaderProps) {
  const { title, description } = pageTitles[currentPage];

  const handleOpenDashboard = async () => {
    // 调用 Tauri 打开 Dashboard URL
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // 这里可以调用后端获取带 token 的 dashboard URL
      const { open } = await import('@tauri-apps/plugin-shell');
      await open('http://localhost:18789');
    } catch (e) {
      console.error('打开 Dashboard 失败:', e);
    }
  };

  return (
    <header className="h-14 bg-dark-800/50 border-b border-dark-600 flex items-center justify-between px-6 titlebar-drag backdrop-blur-sm">
      {/* 左侧：页面标题 */}
      <div className="titlebar-no-drag">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="text-xs text-gray-500">{description}</p>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2 titlebar-no-drag">
        <button
          onClick={() => window.location.reload()}
          className="icon-button text-gray-400 hover:text-white"
          title="刷新"
        >
          <RefreshCw size={16} />
        </button>
        <button
          onClick={handleOpenDashboard}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-600 hover:bg-dark-500 text-sm text-gray-300 hover:text-white transition-colors"
          title="打开 Web Dashboard"
        >
          <ExternalLink size={14} />
          <span>Dashboard</span>
        </button>
      </div>
    </header>
  );
}
