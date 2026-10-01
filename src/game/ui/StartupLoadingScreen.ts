import type Phaser from 'phaser';

/** The initial DOM exists before JavaScript; scenes only update and retire it. */
export function isStartupLoadingVisible(): boolean {
  return document.getElementById('startup-loading') !== null;
}

export function updateStartupLoading(progress: number, status = '正在装载海港…'): void {
  if (!Number.isFinite(progress)) return;
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const bar = document.getElementById('startup-loading-progress');
  const fill = document.getElementById('startup-loading-fill');
  const label = document.getElementById('startup-loading-status');
  bar?.setAttribute('aria-valuenow', String(percent));
  if (fill) fill.style.width = `${percent}%`;
  if (label) label.textContent = `${status} ${percent}%`;
}

export function removeStartupLoading(): void {
  document.getElementById('startup-loading')?.remove();
}

/** POST_RENDER happens after the newly created menu has actually painted its canvas. */
export function finishStartupLoadingAfterRender(scene: Phaser.Scene): void {
  if (!isStartupLoadingVisible()) return;
  updateStartupLoading(1, '海港已就绪，准备出航…');
  const finish = (): void => {
    scene.events.off('shutdown', cancel);
    removeStartupLoading();
  };
  const cancel = (): void => { scene.game.events.off('postrender', finish); };
  scene.game.events.once('postrender', finish);
  scene.events.once('shutdown', cancel);
}
