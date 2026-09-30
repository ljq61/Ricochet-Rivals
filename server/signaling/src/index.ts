import { startSignalingServer } from './bootstrap';
import { loadServerConfig } from './serverConfig';

/**
 * Signaling Server 入口（SG-2）。
 *
 * 只做 Signaling（房间配对 / SDP / ICE 转发）—— Gameplay 一律走 WebRTC
 * DataChannel（架构红线见仓库 TASKS.md「Online Connection Migration」）。
 */

const config = loadServerConfig();
const running = startSignalingServer(config);

console.log(
  `[SignalingServer] listening on :${running.port} | waiting TTL ${
    Math.round(config.waitingTtlMs / 1000)
  }s | slot grace ${Math.round(config.slotGraceMs / 1000)}s | iceServers ${config.iceServers.length}`,
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[SignalingServer] ${signal} — shutting down`);
  await running.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
