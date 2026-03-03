import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ExternalLink,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { setupLogger } from '../../lib/logger';

interface EnvironmentStatus {
  node_installed: boolean;
  node_version: string | null;
  node_version_ok: boolean;
  openclaw_installed: boolean;
  openclaw_version: string | null;
  config_dir_exists: boolean;
  ready: boolean;
  os: string;
}

interface InstallResult {
  success: boolean;
  message: string;
  error: string | null;
}

interface NpmNetworkStatus {
  healthy: boolean;
  latency_ms: number | null;
  current_registry: string | null;
  recommended_registry: string | null;
  message: string;
}

interface DiagnosticRequest {
  stage: string;
  error: string | null;
  code?: string | null;
  context?: string[];
  logs: string[];
}

interface RecoveryAction {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
}

interface InstallFailureAnalysis {
  code: string;
  title: string;
  reason: string;
  impact: string;
  next_step: string;
  retryable: boolean;
  actions: RecoveryAction[];
}

interface SetupProps {
  onComplete: () => void;
  embedded?: boolean;
}

type SetupStage = 'welcome' | 'checking' | 'check' | 'installing' | 'repair' | 'done';
type CheckState = 'pass' | 'fixable' | 'manual';
type InstallStatus = 'pending' | 'running' | 'success' | 'failed';

interface CheckItem {
  id: string;
  title: string;
  status: CheckState;
  detail: string;
}

interface InstallStep {
  id: 'prepare' | 'node' | 'openclaw' | 'init' | 'verify';
  title: string;
  hint: string;
}

interface InstallStepState {
  status: InstallStatus;
  message: string;
}

interface RepairPlan {
  code?: string;
  title: string;
  reason: string;
  impact: string;
  nextStep: string;
  actionLabel?: string;
  action: 'recheck' | 'retry-install' | 'node-terminal' | 'openclaw-terminal' | 'admin-retry';
}

type FailedStage = 'check' | 'node' | 'openclaw' | 'init' | 'verify' | 'network' | 'unknown';

const INSTALL_STEPS: InstallStep[] = [
  {
    id: 'prepare',
    title: '准备安装环境',
    hint: '校验安装前置条件并准备执行环境。',
  },
  {
    id: 'node',
    title: '安装 Node.js',
    hint: 'OpenClaw 依赖 Node.js 22 及以上版本。',
  },
  {
    id: 'openclaw',
    title: '安装 OpenClaw',
    hint: '使用官方 npm 包完成安装。',
  },
  {
    id: 'init',
    title: '初始化配置',
    hint: '创建必要目录并写入基础配置。',
  },
  {
    id: 'verify',
    title: '完成验证',
    hint: '验证安装结果并准备进入控制台。',
  },
];

const createStepState = (): Record<InstallStep['id'], InstallStepState> => ({
  prepare: { status: 'pending', message: '等待执行' },
  node: { status: 'pending', message: '等待执行' },
  openclaw: { status: 'pending', message: '等待执行' },
  init: { status: 'pending', message: '等待执行' },
  verify: { status: 'pending', message: '等待执行' },
});

export function Setup({ onComplete, embedded = false }: SetupProps) {
  const [stage, setStage] = useState<SetupStage>('welcome');
  const [envStatus, setEnvStatus] = useState<EnvironmentStatus | null>(null);
  const [checkItems, setCheckItems] = useState<CheckItem[]>([]);
  const [stepStates, setStepStates] = useState<Record<InstallStep['id'], InstallStepState>>(createStepState());
  const [activeStepId, setActiveStepId] = useState<InstallStep['id'] | null>(null);
  const [repairPlan, setRepairPlan] = useState<RepairPlan | null>(null);
  const [failedStage, setFailedStage] = useState<FailedStage>('unknown');
  const [repairing, setRepairing] = useState(false);
  const [repairFeedback, setRepairFeedback] = useState<string | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const stoppedRef = useRef(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsExpanded && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, logsExpanded]);

  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  const compactError = (result: InstallResult) => {
    const raw = (result.error || result.message || '').trim();
    if (!raw) {
      return '未知错误';
    }
    return raw.length > 280 ? `${raw.slice(0, 280)}...` : raw;
  };

  const humanizeInstallError = (text: string) => {
    const normalized = text.toLowerCase();

    if (
      normalized.includes('objectnotfound: (node:string)') ||
      normalized.includes('commandnotfoundexception') ||
      normalized.includes('could not be loaded')
    ) {
      return '当前系统还没有可用的 Node.js 命令，正在自动切换下一种安装方式。';
    }

    const msiCode = normalized.match(/msiexec failed with code\s*(\d+)/);
    if (msiCode?.[1]) {
      return `Node 安装程序返回错误码 ${msiCode[1]}。`;
    }

    if (text.includes('�')) {
      return '安装器返回了不可读日志，已自动继续下一步安装策略。';
    }

    return text;
  };

  const invokeWithHeartbeat = async <T,>(
    command: string,
    args: Record<string, unknown> | undefined,
    heartbeatMessage: string,
    intervalMs = 8000
  ): Promise<T> => {
    let elapsedSeconds = 0;
    const timer = window.setInterval(() => {
      elapsedSeconds += Math.floor(intervalMs / 1000);
      if (elapsedSeconds >= 60) {
        appendLog(`${heartbeatMessage}（已等待 ${elapsedSeconds} 秒，可能需要系统权限确认）`);
      } else {
        appendLog(heartbeatMessage);
      }
    }, intervalMs);

    try {
      return await invoke<T>(command, args);
    } finally {
      window.clearInterval(timer);
    }
  };

  const updateStep = (id: InstallStep['id'], status: InstallStatus, message: string) => {
    setStepStates((prev) => ({
      ...prev,
      [id]: { status, message },
    }));
  };

  const getOsName = (os: string) => {
    switch (os) {
      case 'windows':
        return 'Windows';
      case 'macos':
        return 'macOS';
      case 'linux':
        return 'Linux';
      default:
        return os;
    }
  };

  const buildCheckItems = (status: EnvironmentStatus, networkStatus?: NpmNetworkStatus | null): CheckItem[] => [
    {
      id: 'os',
      title: '系统平台',
      status: status.os === 'windows' ? 'pass' : 'manual',
      detail:
        status.os === 'windows'
          ? '当前是 Windows，符合本期安装器支持范围。'
          : `当前是 ${getOsName(status.os)}，首版优先支持 Windows。`,
    },
    {
      id: 'node',
      title: 'Node.js 环境',
      status: status.node_installed && status.node_version_ok ? 'pass' : 'fixable',
      detail: status.node_installed
        ? status.node_version_ok
          ? `已安装 ${status.node_version}，版本符合要求。`
          : `检测到 ${status.node_version}，需要升级到 v22 及以上。`
        : '未检测到 Node.js，可自动安装。',
    },
    {
      id: 'openclaw',
      title: 'OpenClaw 主程序',
      status: status.openclaw_installed ? 'pass' : 'fixable',
      detail: status.openclaw_installed
        ? `已安装 ${status.openclaw_version || 'OpenClaw'}。`
        : '尚未安装，可一键自动安装。',
    },
    {
      id: 'config',
      title: '配置目录',
      status: status.config_dir_exists ? 'pass' : 'fixable',
      detail: status.config_dir_exists
        ? '配置目录已存在，可继续。'
        : '配置目录将由安装流程自动初始化。',
    },
    {
      id: 'network',
      title: '网络下载线路',
      status: networkStatus ? (networkStatus.healthy ? 'pass' : 'fixable') : 'fixable',
      detail: networkStatus
        ? `${networkStatus.message}${networkStatus.current_registry ? `（当前：${networkStatus.current_registry}）` : ''}`
        : '安装时会自动检测网络稳定性，必要时推荐切换稳定线路（可自动恢复）。',
    },
  ];

  const checkEnvironment = async () => {
    setupLogger.info('检查系统环境...');
    setStage('checking');
    appendLog('开始环境检测。');

    try {
      const status = await invoke<EnvironmentStatus>('check_environment');
      let networkStatus: NpmNetworkStatus | null = null;
      try {
        networkStatus = await invoke<NpmNetworkStatus>('precheck_npm_registry');
      } catch (networkError) {
        setupLogger.warn('npm 网络预检失败，继续使用默认检测', networkError);
      }

      setupLogger.state('环境状态', status);
      setEnvStatus(status);
      setCheckItems(buildCheckItems(status, networkStatus));
      appendLog('环境检测完成。');
      setStage(status.ready ? 'done' : 'check');
    } catch (e) {
      setupLogger.error('检查环境失败', e);
      appendLog('环境检测失败，已准备修复建议。');
      const repairPlan = await resolveRepairPlan('check', String(e), {
        title: '环境检测未完成',
        reason: '安装器暂时无法拿到完整环境信息。',
        impact: '无法安全开始安装。',
        nextStep: '点击“重新检测”重试，若仍失败可导出诊断信息。',
        action: 'recheck',
      });
      moveToRepair('check', repairPlan);
    }
  };

  const moveToRepair = (stageKey: FailedStage, plan: RepairPlan) => {
    setFailedStage(stageKey);
    setRepairPlan(plan);
    setRepairing(false);
    setRepairFeedback(null);
    setLogsExpanded(true);
    setStage('repair');
  };

  const resolveRepairPlan = async (
    stageKey: string,
    rawError: string,
    fallback: RepairPlan
  ): Promise<RepairPlan> => {
    try {
      const analysis = await invoke<InstallFailureAnalysis>('analyze_install_failure', {
        stage: stageKey,
        error: rawError,
      });

      const recommendedAction = analysis.actions.find((item) => item.recommended);
      const mappedAction: RepairPlan['action'] =
        recommendedAction?.id === 'recheck' ||
        recommendedAction?.id === 'retry-install' ||
        recommendedAction?.id === 'node-terminal' ||
        recommendedAction?.id === 'openclaw-terminal' ||
        recommendedAction?.id === 'admin-retry'
          ? recommendedAction.id
          : fallback.action;

      return {
        code: analysis.code,
        title: analysis.title,
        reason: analysis.reason,
        impact: analysis.impact,
        nextStep: analysis.next_step,
        actionLabel: recommendedAction?.label,
        action: mappedAction,
      };
    } catch (analysisError) {
      setupLogger.warn('失败分析接口调用失败，使用默认修复建议', analysisError);
      return fallback;
    }
  };

  const installFlow = async (): Promise<boolean> => {
    if (!envStatus) {
      await checkEnvironment();
      return false;
    }

    setupLogger.action('执行一键安装');
    setStage('installing');
    setLogsExpanded(true);
    stoppedRef.current = false;
    setStepStates(createStepState());

    let usingTemporaryRegistry = false;

    try {
      setActiveStepId('prepare');
      updateStep('prepare', 'running', '正在准备安装任务...');
      appendLog('正在准备安装任务。');

      await new Promise((resolve) => setTimeout(resolve, 500));
      if (stoppedRef.current) {
        updateStep('prepare', 'failed', '安装已手动停止。');
        return false;
      }
      updateStep('prepare', 'success', '环境准备完成。');

      setActiveStepId('node');
      if (envStatus.node_installed && envStatus.node_version_ok) {
        updateStep('node', 'success', `已检测到 ${envStatus.node_version}。`);
      } else {
        appendLog('开始安装 Node.js。');
        appendLog('Node.js 安装可能需要 30-120 秒，请稍候。');
        let finalNodeResult: InstallResult;

        if (envStatus.os === 'windows') {
          updateStep('node', 'running', '正在自动安装 Node.js（管理员权限）...');
          appendLog('检测到 Windows，优先使用管理员权限安装以提升成功率。');
          finalNodeResult = await invokeWithHeartbeat<InstallResult>(
            'install_nodejs_admin',
            undefined,
            'Node.js 管理员安装仍在进行中，请耐心等待。若出现系统权限弹窗，请点击“是”。'
          );

          if (!finalNodeResult.success) {
            appendLog(`管理员安装未完成：${humanizeInstallError(compactError(finalNodeResult))}`);
            appendLog('正在回退普通权限安装 Node.js。');
            updateStep('node', 'running', '正在自动安装 Node.js（普通权限回退）...');
            finalNodeResult = await invokeWithHeartbeat<InstallResult>(
              'install_nodejs',
              undefined,
              'Node.js 仍在安装中，请勿关闭应用。'
            );
          }
        } else {
          updateStep('node', 'running', '正在自动安装 Node.js（普通权限）...');
          finalNodeResult = await invokeWithHeartbeat<InstallResult>(
            'install_nodejs',
            undefined,
            'Node.js 仍在安装中，请勿关闭应用。'
          );
        }

        if (!finalNodeResult.success) {
          updateStep('node', 'failed', finalNodeResult.message);
          const mergedError = compactError(finalNodeResult);
          const repairPlan = await resolveRepairPlan('node', mergedError, {
            title: 'Node.js 安装未完成',
            reason: mergedError,
            impact: 'OpenClaw 无法继续安装。',
            nextStep: '点击“推荐修复”后将自动重试。',
            action: 'retry-install',
          });
          moveToRepair('node', repairPlan);
          return false;
        }

        updateStep('node', 'success', finalNodeResult.message);
        appendLog('Node.js 安装完成。');

        const latestAfterNode = await invoke<EnvironmentStatus>('check_environment');
        setEnvStatus(latestAfterNode);
        setCheckItems(buildCheckItems(latestAfterNode));

        if (!(latestAfterNode.node_installed && latestAfterNode.node_version_ok)) {
          updateStep('node', 'failed', 'Node.js 安装后校验未通过。');
          const repairPlan = await resolveRepairPlan('node', 'Node.js 安装后校验未通过。', {
            title: 'Node.js 安装未完成',
            reason: '安装流程已执行，但当前仍未检测到可用 Node.js 22+。',
            impact: 'OpenClaw 无法继续安装。',
            nextStep: '建议点击“推荐修复”继续自动处理。',
            action: 'retry-install',
          });
          moveToRepair('node', repairPlan);
          return false;
        }
      }

      setActiveStepId('openclaw');
      if (envStatus.openclaw_installed) {
        updateStep('openclaw', 'success', `已检测到 ${envStatus.openclaw_version || 'OpenClaw'}。`);
      } else {
        const networkStatus = await invoke<NpmNetworkStatus>('precheck_npm_registry');
        if (!networkStatus.healthy) {
          appendLog(networkStatus.message);
          const temporaryResult = await invoke<InstallResult>('use_temporary_npm_registry', {
            registry: networkStatus.recommended_registry,
          });
          if (temporaryResult.success) {
            usingTemporaryRegistry = true;
            appendLog('已临时切换稳定线路，安装完成后会自动恢复。');
          } else {
            const repairPlan = await resolveRepairPlan('network', temporaryResult.error || temporaryResult.message, {
              title: '网络线路切换失败',
              reason: temporaryResult.error || temporaryResult.message,
              impact: '当前网络可能导致安装中断。',
              nextStep: '点击“管理员权限重试”或手动检查网络后重试。',
              action: 'admin-retry',
            });
            moveToRepair('network', repairPlan);
            return false;
          }
        }

        updateStep('openclaw', 'running', '正在安装 OpenClaw...');
        appendLog('开始安装 OpenClaw。');
        const openclawResult = await invoke<InstallResult>('install_openclaw');
        if (!openclawResult.success) {
          updateStep('openclaw', 'failed', openclawResult.message);
          const repairPlan = await resolveRepairPlan('openclaw', openclawResult.error || openclawResult.message, {
            title: 'OpenClaw 安装未完成',
            reason: openclawResult.error || openclawResult.message,
            impact: '当前无法进入配置和服务管理。',
            nextStep: '点击“推荐修复”重新执行安装。',
            action: 'retry-install',
          });
          moveToRepair('openclaw', repairPlan);
          return false;
        }
        updateStep('openclaw', 'success', openclawResult.message);
        appendLog('OpenClaw 安装完成。');
      }

      setActiveStepId('init');
      updateStep('init', 'running', '正在初始化配置...');
      appendLog('开始初始化配置目录。');
      const initResult = await invoke<InstallResult>('init_openclaw_config');
      if (!initResult.success) {
        updateStep('init', 'failed', initResult.message);
        const repairPlan = await resolveRepairPlan('init', initResult.error || initResult.message, {
          title: '配置初始化未完成',
          reason: initResult.error || initResult.message,
          impact: 'OpenClaw 可能无法正常启动。',
          nextStep: '点击“推荐修复”后将重试初始化。',
          action: 'retry-install',
        });
        moveToRepair('init', repairPlan);
        return false;
      }
      updateStep('init', 'success', initResult.message);

      setActiveStepId('verify');
      updateStep('verify', 'running', '正在验证安装结果...');
      appendLog('开始验证安装结果。');
      const latestStatus = await invoke<EnvironmentStatus>('check_environment');
      setEnvStatus(latestStatus);
      setCheckItems(buildCheckItems(latestStatus));

      if (!latestStatus.ready) {
        updateStep('verify', 'failed', '验证未通过，请进行推荐修复。');
        const repairPlan = await resolveRepairPlan('verify', '安装步骤已执行，但环境状态仍未完全就绪。', {
          title: '验证未通过',
          reason: '安装步骤已执行，但环境状态仍未完全就绪。',
          impact: '可能无法稳定运行 OpenClaw 服务。',
          nextStep: '点击“推荐修复”从当前步骤继续。',
          action: 'retry-install',
        });
        moveToRepair('verify', repairPlan);
        return false;
      }

      updateStep('verify', 'success', '验证完成，安装已就绪。');
      appendLog('全部安装步骤完成。');
      setStage('done');
      return true;
    } catch (e) {
      setupLogger.error('安装流程失败', e);
      appendLog('安装流程出现异常。');
      const repairPlan = await resolveRepairPlan('unknown', String(e), {
        title: '安装流程中断',
        reason: String(e),
        impact: '本次安装未完成。',
        nextStep: '点击“推荐修复”可自动重试。',
        action: 'retry-install',
      });
      moveToRepair('unknown', repairPlan);
      return false;
    } finally {
      if (usingTemporaryRegistry) {
        try {
          const restoreResult = await invoke<InstallResult>('restore_npm_registry');
          if (restoreResult.success) {
            appendLog('已恢复到原始下载线路。');
          } else {
            appendLog(`下载线路恢复失败：${restoreResult.error || restoreResult.message}`);
          }
        } catch (restoreError) {
          appendLog(`下载线路恢复失败：${String(restoreError)}`);
        }
      }
    }
  };

  const runRecommendedRepair = async () => {
    if (!repairPlan) {
      return;
    }

    setRepairing(true);
    setRepairFeedback(null);

    try {
      if (repairPlan.action === 'recheck') {
        await checkEnvironment();
        setRepairFeedback('已完成重新检测。');
        return;
      }

      if (repairPlan.action === 'node-terminal') {
        await invoke<string>('open_install_terminal', { installType: 'nodejs' });
        appendLog('已打开 Node.js 安装终端。');
        setRepairFeedback('已打开安装终端，请完成安装后点击“重新检测环境”。');
        return;
      }

      if (repairPlan.action === 'openclaw-terminal') {
        await invoke<string>('open_install_terminal', { installType: 'openclaw' });
        appendLog('已打开 OpenClaw 安装终端。');
        setRepairFeedback('已打开安装终端，请完成安装后点击“重新检测环境”。');
        return;
      }

      if (repairPlan.action === 'admin-retry') {
        appendLog('正在执行管理员修复，请在弹出的系统窗口中允许授权。');
        const adminRetryReady = await runAdminRetry();
        if (adminRetryReady) {
          setRepairFeedback('管理员修复已完成，Node.js 环境已就绪。');
        } else {
          setRepairFeedback('已触发管理员重试。若仍失败，请查看日志后点击“重新检测环境”。');
        }
        return;
      }

      const installReady = await installFlow();
      if (installReady) {
        setRepairFeedback('推荐修复已完成，环境已就绪。');
      } else {
        setRepairFeedback('推荐修复已执行。若仍失败，请查看日志后点击“重新检测环境”确认状态。');
      }
    } finally {
      setRepairing(false);
    }
  };

  const runAdminRetry = async (): Promise<boolean> => {
    try {
      appendLog('已触发管理员权限重试。');

      if (failedStage === 'node') {
        appendLog('正在以管理员权限自动安装 Node.js，请在系统弹窗中允许授权。');
        const result = await invokeWithHeartbeat<InstallResult>(
          'install_nodejs_admin',
          undefined,
          '管理员 Node.js 安装仍在进行中，请先完成系统授权。'
        );
        if (!result.success) {
          appendLog(`管理员安装失败：${result.error || result.message}`);
          return false;
        }

        appendLog(result.message);
        const latestStatus = await invoke<EnvironmentStatus>('check_environment');
        setEnvStatus(latestStatus);
        setCheckItems(buildCheckItems(latestStatus));

        if (latestStatus.node_installed && latestStatus.node_version_ok) {
          appendLog(`Node.js 已就绪：${latestStatus.node_version || 'v22+'}`);
          if (latestStatus.ready) {
            setStage('done');
          }
          return true;
        }

        appendLog('管理员安装已执行，但当前会话未检测到 Node.js 22+，建议点击“重新检测环境”。');
        return false;
      }

      const installType = failedStage === 'openclaw' || failedStage === 'network' ? 'openclaw' : 'nodejs';
      await invoke<string>('open_install_terminal', { installType });
      appendLog('已打开管理员终端，请按提示完成操作。');
      return false;
    } catch (e) {
      appendLog(`管理员重试打开失败：${String(e)}`);
      return false;
    }
  };

  const exportDiagnostic = async () => {
    const context: string[] = [
      `失败阶段: ${failedStage}`,
      `检测项统计: pass=${checkSummary.passCount},fixable=${checkSummary.fixableCount},manual=${checkSummary.manualCount}`,
      ...Object.entries(stepStates).map(([key, state]) => `步骤 ${key}: ${state.status} - ${state.message}`),
    ];

    try {
      const reportPath = await invoke<string>('export_install_diagnostic_report', {
        req: {
          stage,
          error: repairPlan?.reason || null,
          code: repairPlan?.code || null,
          context,
          logs,
        } as DiagnosticRequest,
      });

      await navigator.clipboard.writeText(reportPath);
      appendLog(`诊断报告已导出：${reportPath}`);
      appendLog('报告路径已复制到剪贴板。');
    } catch (e) {
      appendLog(`导出失败：${String(e)}`);
    }
  };

  const checkSummary = useMemo(() => {
    const passCount = checkItems.filter((item) => item.status === 'pass').length;
    const fixableCount = checkItems.filter((item) => item.status === 'fixable').length;
    const manualCount = checkItems.filter((item) => item.status === 'manual').length;
    return { passCount, fixableCount, manualCount };
  }, [checkItems]);

  const renderCheckBadge = (state: CheckState) => {
    if (state === 'pass') {
      return <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-300">通过</span>;
    }
    if (state === 'fixable') {
      return <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300">可修复</span>;
    }
    return <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-300">需手动</span>;
  };

  const renderStepIcon = (status: InstallStatus) => {
    if (status === 'running') {
      return <Loader2 className="w-4 h-4 text-accent-cyan animate-spin" />;
    }
    if (status === 'success') {
      return <CheckCircle2 className="w-4 h-4 text-accent-green" />;
    }
    if (status === 'failed') {
      return <AlertTriangle className="w-4 h-4 text-red-300" />;
    }
    return <span className="w-4 h-4 rounded-full border border-dark-400 block" />;
  };

  const renderContent = () => (
    <AnimatePresence mode="wait">
      {stage === 'welcome' && (
        <motion.div
          key="welcome"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-white">3 分钟完成 OpenClaw 安装</h3>
            <p className="text-sm text-dark-300 leading-relaxed">
              我们会自动检查环境并完成安装。你不用输入命令，失败后也能一键修复。
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-dark-200">
              <Check className="w-4 h-4 text-accent-green" />
              不会删除你的个人文件
            </div>
            <div className="flex items-center gap-2 text-sm text-dark-200">
              <Check className="w-4 h-4 text-accent-green" />
              安装失败也能从当前步骤继续
            </div>
            <div className="flex items-center gap-2 text-sm text-dark-200">
              <Check className="w-4 h-4 text-accent-green" />
              全程可查看详细日志
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={checkEnvironment} className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-2">
              <PlayCircle className="w-4 h-4" />
              开始安装（推荐）
            </button>
            <a
              href="https://github.com/miaoxworld/openclaw-manager"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary py-2.5 px-4 flex items-center justify-center gap-2"
            >
              说明
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </motion.div>
      )}

      {stage === 'checking' && (
        <motion.div
          key="checking"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-center py-8"
        >
          <Loader2 className="w-10 h-10 text-accent-cyan animate-spin mx-auto mb-3" />
          <p className="text-dark-200">正在检查环境，请稍候...</p>
          <p className="text-xs text-dark-400 mt-2">这一步通常在 5-15 秒内完成</p>
        </motion.div>
      )}

      {stage === 'check' && (
        <motion.div
          key="check"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="space-y-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white">环境检测结果</h3>
              <p className="text-sm text-dark-300 mt-1">
                通过 {checkSummary.passCount} 项，待修复 {checkSummary.fixableCount} 项。
              </p>
            </div>
            {envStatus && (
              <span className="text-xs px-2 py-1 rounded-md bg-dark-600 text-dark-200">{getOsName(envStatus.os)}</span>
            )}
          </div>

          <div className="space-y-2">
            {checkItems.map((item) => (
              <div key={item.id} className="p-3 rounded-xl bg-dark-700/70 border border-dark-600">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  {renderCheckBadge(item.status)}
                </div>
                <p className="text-xs text-dark-300 mt-1.5">{item.detail}</p>
              </div>
            ))}
          </div>

          {checkSummary.manualCount > 0 && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">
              当前存在需要手动处理的项。你仍可继续检测或查看修复建议。
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={installFlow} className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-2">
              <Wrench className="w-4 h-4" />
              一键安装并修复
            </button>
            <button onClick={checkEnvironment} className="btn-secondary py-2.5 px-4 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4" />
              重新检测
            </button>
          </div>
        </motion.div>
      )}

      {stage === 'installing' && (
        <motion.div
          key="install"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="space-y-4"
        >
          <div>
            <h3 className="text-lg font-semibold text-white">正在安装，请稍候</h3>
            <p className="text-sm text-dark-300 mt-1">你可以最小化窗口，安装完成会有明确提示。</p>
          </div>

          <div className="space-y-2">
            {INSTALL_STEPS.map((step, index) => {
              const state = stepStates[step.id];
              return (
                <div
                  key={step.id}
                  className={`p-3 rounded-xl border ${
                    activeStepId === step.id ? 'border-accent-cyan/50 bg-accent-cyan/10' : 'border-dark-600 bg-dark-700/70'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {renderStepIcon(state.status)}
                    <div>
                      <p className="text-sm font-medium text-white">
                        {index + 1}. {step.title}
                      </p>
                      <p className="text-xs text-dark-300 mt-0.5">{state.message || step.hint}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                stoppedRef.current = true;
                appendLog('已收到停止安装请求。');
              }}
              className="btn-secondary py-2.5 px-4"
            >
              停止安装
            </button>
            <button onClick={() => setLogsExpanded((prev) => !prev)} className="btn-ghost py-2.5 px-4 flex items-center gap-2">
              {logsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {logsExpanded ? '收起日志' : '查看详细日志'}
            </button>
          </div>
        </motion.div>
      )}

      {stage === 'repair' && repairPlan && (
        <motion.div
          key="repair"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="space-y-4"
        >
          <div className="flex items-start gap-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
            <ShieldAlert className="w-5 h-5 text-amber-300 mt-0.5" />
            <div className="min-w-0">
              <h3 className="text-white font-semibold">{repairPlan.title}</h3>
              <p className="text-sm text-amber-100/90 mt-1 whitespace-pre-wrap break-words">{repairPlan.reason}</p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-dark-700/70 border border-dark-600 space-y-2">
            <p className="text-sm text-dark-200 whitespace-pre-wrap break-words">
              <span className="text-dark-400">影响：</span>
              {repairPlan.impact}
            </p>
            <p className="text-sm text-dark-200 whitespace-pre-wrap break-words">
              <span className="text-dark-400">下一步：</span>
              {repairPlan.nextStep}
            </p>
          </div>

          {repairFeedback && (
            <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-sm text-cyan-100 whitespace-pre-wrap break-words">
              {repairFeedback}
            </div>
          )}

          <div className="space-y-2">
            <button
              onClick={runRecommendedRepair}
              disabled={repairing}
              className="w-full btn-primary py-2.5 flex items-center justify-center gap-2"
            >
              {repairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
              {repairing ? '修复中...' : repairPlan.actionLabel || '执行推荐修复'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  const ok = await runAdminRetry();
                  if (ok) {
                    setRepairFeedback('管理员修复已完成，Node.js 环境已就绪。');
                  } else {
                    setRepairFeedback('管理员重试已执行。若仍失败，请查看日志后点击“重新检测环境”。');
                  }
                }}
                disabled={repairing}
                className="btn-secondary py-2.5 px-3 text-sm"
              >
                管理员权限重试
              </button>
              <button
                onClick={exportDiagnostic}
                disabled={repairing}
                className="btn-secondary py-2.5 px-3 text-sm flex items-center justify-center gap-2"
              >
                <Clipboard className="w-4 h-4" />
                导出诊断
              </button>
            </div>
            <button
              onClick={checkEnvironment}
              disabled={repairing}
              className="w-full btn-secondary py-2 text-sm"
            >
              重新检测环境
            </button>
            <button
              onClick={() => setLogsExpanded((prev) => !prev)}
              disabled={repairing}
              className="w-full btn-ghost py-2 text-sm flex items-center justify-center gap-2"
            >
              {logsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {logsExpanded ? '收起安装日志' : '展开安装日志'}
            </button>
          </div>
        </motion.div>
      )}

      {stage === 'done' && (
        <motion.div
          key="done"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          className="space-y-5"
        >
          <div className="text-center py-2">
            <CheckCircle2 className="w-12 h-12 text-accent-green mx-auto mb-2" />
            <h3 className="text-lg font-semibold text-white">安装完成，环境已就绪</h3>
            <p className="text-sm text-dark-300 mt-1">你现在可以进入控制台，继续配置模型和消息渠道。</p>
          </div>

          <div className="p-3 rounded-lg bg-dark-700/70 border border-dark-600 text-sm text-dark-200">
            Node.js 与 OpenClaw 已安装，基础配置已初始化。
          </div>

          <div className="flex gap-3">
            <button onClick={onComplete} className="flex-1 btn-primary py-2.5 flex items-center justify-center gap-2">
              进入控制台
              <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={checkEnvironment} className="btn-secondary py-2.5 px-4">
              再次检测
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const renderLogsPanel = () => {
    if (!(stage === 'installing' || stage === 'repair') || !logsExpanded) {
      return null;
    }

    return (
      <div className="mt-4 rounded-xl border border-dark-600 bg-dark-800">
        <div className="px-3 py-2 border-b border-dark-600 text-xs text-dark-300">安装日志（面向诊断）</div>
        <div ref={logsContainerRef} className="max-h-52 overflow-y-auto p-3 font-mono text-xs space-y-1 text-dark-200">
          {logs.length === 0 ? (
            <p className="text-dark-400">暂无日志</p>
          ) : (
            logs.map((line, idx) => (
              <p key={idx} className="whitespace-pre-wrap break-all">
                {line}
              </p>
            ))
          )}
        </div>
      </div>
    );
  };

  if (embedded) {
    return (
      <div className="bg-gradient-to-br from-amber-500/15 via-dark-700 to-accent-cyan/10 border border-amber-500/30 rounded-2xl p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-claw-500 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white mb-1">安装向导</h2>
            <p className="text-dark-300 text-sm">当前环境还未完全就绪，按步骤操作即可完成安装。</p>
          </div>
        </div>

        {renderContent()}
        {renderLogsPanel()}
      </div>
    );
  }

  return (
    <div className="min-h-screen app-shell-bg flex items-center justify-center p-8 overflow-y-auto">
      <div className="fixed inset-0 bg-gradient-radial pointer-events-none" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-accent-cyan/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-claw-500/10 rounded-full blur-3xl" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-xl">
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 14 }}
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-claw-500 to-accent-cyan mb-4 shadow-lg shadow-claw-500/20"
          >
            <span className="text-4xl">🦞</span>
          </motion.div>
          <h1 className="text-2xl font-bold text-white mb-2">OpenClaw Studio</h1>
          <p className="text-dark-300">Windows 一键安装助手</p>
        </div>

        <motion.div layout className="premium-card rounded-2xl p-6">
          {renderContent()}
          {renderLogsPanel()}
        </motion.div>

        <p className="text-center text-dark-500 text-xs mt-6">OpenClaw Studio v0.0.7</p>
      </motion.div>
    </div>
  );
}
