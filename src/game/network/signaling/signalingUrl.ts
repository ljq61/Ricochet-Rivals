/**
 * Signaling Server 地址解析（SG-5 定义、SG-8 提取共享 —— RoomConnectionController
 * 初始配对与 RoomRecoveryController 对局期重信令用同一解析口径）。
 *
 * 优先级：E2E 页面注入（`__RR_SIGNALING_URL__`，构建产物免重 Build）>
 * 构建期 env（`VITE_SIGNALING_URL`，部署配置）> 本地开发默认。
 */

const LOCAL_DEFAULT_URL = 'ws://127.0.0.1:8787';

export function resolveSignalingUrl(): string {
  const injected = (window as unknown as Record<string, unknown>).__RR_SIGNALING_URL__;
  if (typeof injected === 'string' && injected.startsWith('ws')) {
    return injected;
  }
  const fromEnv = import.meta.env['VITE_SIGNALING_URL'];
  if (typeof fromEnv === 'string' && fromEnv.startsWith('ws')) {
    return fromEnv;
  }
  return LOCAL_DEFAULT_URL;
}
