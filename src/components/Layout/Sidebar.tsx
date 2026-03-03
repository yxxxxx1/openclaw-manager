import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Bot,
  MessageSquare,
  FlaskConical,
  ScrollText,
  Settings,
} from 'lucide-react';
import { PageType } from '../../App';
import clsx from 'clsx';

interface ServiceStatus {
  running: boolean;
  pid: number | null;
  port: number;
}

interface SidebarProps {
  currentPage: PageType;
  onNavigate: (page: PageType) => void;
  serviceStatus: ServiceStatus | null;
  configExpanded: boolean;
  onConfigExpandedChange: (expanded: boolean) => void;
}

const menuItems: { id: PageType; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: '概览', icon: LayoutDashboard },
  { id: 'ai', label: 'AI 配置', icon: Bot },
  { id: 'channels', label: '消息渠道', icon: MessageSquare },
  { id: 'testing', label: '测试诊断', icon: FlaskConical },
  { id: 'logs', label: '应用日志', icon: ScrollText },
  { id: 'settings', label: '设置', icon: Settings },
];

export function Sidebar({
  currentPage,
  onNavigate,
  serviceStatus,
  configExpanded,
  onConfigExpandedChange,
}: SidebarProps) {
  const isRunning = serviceStatus?.running ?? false;
  const isConfigPage = currentPage !== 'dashboard';
  const moreIds: PageType[] = ['testing', 'logs', 'settings'];

  const renderMenuItem = (item: { id: PageType; label: string; icon: React.ElementType }) => {
    const isActive = currentPage === item.id;
    const Icon = item.icon;

    return (
      <li key={item.id}>
        <button
          onClick={() => onNavigate(item.id)}
          className={clsx(
            'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all relative',
            isActive
              ? 'text-white bg-[linear-gradient(90deg,rgba(34,211,238,0.18),rgba(34,211,238,0.08))] border border-cyan-500/30'
              : 'text-gray-300 hover:text-white hover:bg-dark-700/70 border border-transparent'
          )}
        >
          {isActive && (
            <motion.div
              layoutId="activeIndicator"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-7 bg-accent-cyan rounded-r-full"
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          )}
          <Icon size={18} className={isActive ? 'text-accent-cyan' : 'text-gray-400'} />
          <span>{item.label}</span>
        </button>
      </li>
    );
  };

  return (
    <aside className="w-72 premium-card border-r soft-divider flex flex-col m-3 mr-0 rounded-2xl overflow-hidden">
      <div className="h-16 flex items-center px-5 titlebar-drag border-b soft-divider">
        <div className="flex items-center gap-3 titlebar-no-drag">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-claw-500 to-accent-cyan flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="text-xl">🦞</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-wide">OpenClaw Studio</h1>
            <p className="text-xs text-gray-400">部署与运营中心</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-3">
        <p className="section-title px-3 pb-2">工作台</p>
        <ul className="space-y-1">
          {renderMenuItem(menuItems[0])}

          <li>
            <button
              onClick={() => onConfigExpandedChange(!configExpanded)}
              className={clsx(
                'w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium border transition-all',
                isConfigPage
                  ? 'text-white bg-[linear-gradient(90deg,rgba(249,77,58,0.16),rgba(249,77,58,0.08))] border-claw-500/30'
                  : 'text-gray-300 hover:text-white hover:bg-dark-700/70 border-transparent'
              )}
            >
              <span className="flex items-center gap-3">
                <Settings size={18} className={isConfigPage ? 'text-claw-300' : 'text-gray-400'} />
                全部配置
              </span>
              {configExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          </li>

          {configExpanded && (
            <>
              {menuItems
                .filter((item) => item.id !== 'dashboard' && !moreIds.includes(item.id))
                .map(renderMenuItem)}
              {menuItems.filter((item) => moreIds.includes(item.id)).map(renderMenuItem)}
            </>
          )}
        </ul>
      </nav>

      <div className="p-4 border-t soft-divider bg-black/10">
        <div className="px-4 py-3 rounded-xl border border-dark-500/80 bg-dark-800/70">
          <div className="flex items-center justify-between mb-2">
            <span className="section-title">Gateway</span>
            <span className={clsx('status-chip', isRunning ? 'text-green-300 border-green-500/40 bg-green-500/10' : 'text-red-300 border-red-500/40 bg-red-500/10')}>
              {isRunning ? '在线' : '离线'}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className={clsx('status-dot', isRunning ? 'running' : 'stopped')} />
            <span className="text-xs text-gray-300">{isRunning ? '服务运行中' : '服务未启动'}</span>
          </div>
          <p className="text-xs text-gray-400">端口 {serviceStatus?.port ?? 18789}</p>
        </div>
      </div>
    </aside>
  );
}
