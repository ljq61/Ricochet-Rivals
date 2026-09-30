/// <reference types="vite/client" />

/**
 * Vite 客户端类型（import.meta.env）。SG-5 起 OnlineConnectionScene 读取
 * VITE_SIGNALING_URL（Signaling Server 部署地址；缺省回落本地开发地址）。
 */
interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
