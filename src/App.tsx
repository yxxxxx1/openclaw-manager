import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './components/Layout/Sidebar';
import { Header } from './components/Layout/Header';
import { Dashboard } from './components/Dashboard';
import { AIConfig } from './components/AIConfig';
import { Channels } from './components/Channels';
import { ServiceManager } from './components/Service';
import { Settings } from './components/Settings';
import { Testing } from './components/Testing';

export type PageType = 'dashboard' | 'ai' | 'channels' | 'service' | 'testing' | 'settings';

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');

  const renderPage = () => {
    const pageVariants = {
      initial: { opacity: 0, x: 20 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: -20 },
    };

    const pages: Record<PageType, JSX.Element> = {
      dashboard: <Dashboard />,
      ai: <AIConfig />,
      channels: <Channels />,
      service: <ServiceManager />,
      testing: <Testing />,
      settings: <Settings />,
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

  return (
    <div className="flex h-screen bg-dark-900 overflow-hidden">
      {/* 背景装饰 */}
      <div className="fixed inset-0 bg-gradient-radial pointer-events-none" />
      
      {/* 侧边栏 */}
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 标题栏（macOS 拖拽区域） */}
        <Header currentPage={currentPage} />
        
        {/* 页面内容 */}
        <main className="flex-1 overflow-hidden p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default App;
