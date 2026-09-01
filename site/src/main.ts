import './styles.css';

import { CalculatorPool } from './worker-client';
import { mountCalculator } from './ui';
import type { CharacterMeta, RuntimeManifest, SettingsCatalog } from './types';

const rootCandidate = document.querySelector<HTMLElement>('#app');
if (!rootCandidate) throw new Error('找不到可以顯示應用程式的區域。');
const root: HTMLElement = rootCandidate;

root.innerHTML = '<div class="boot-screen"><span></span><p>正在載入計算機資料…</p></div>';

async function start(): Promise<void> {
  const [catalogResponse, manifestResponse, settingsResponse] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}catalog.json`),
    fetch(`${import.meta.env.BASE_URL}runtime/manifest.json`),
    fetch(`${import.meta.env.BASE_URL}settings.json`),
  ]);
  if (!catalogResponse.ok || !manifestResponse.ok || !settingsResponse.ok) {
    throw new Error('無法載入角色資料。');
  }
  const catalog = await catalogResponse.json() as CharacterMeta[];
  const manifest = await manifestResponse.json() as RuntimeManifest;
  const settings = await settingsResponse.json() as SettingsCatalog;
  const client = new CalculatorPool();
  const cleanup = mountCalculator(root, {
    catalog,
    settings,
    version: manifest.version,
    client,
    storage: () => window.localStorage,
  });
  window.addEventListener('pagehide', cleanup, { once: true });
}

start().catch((error: unknown) => {
  root.replaceChildren();
  const box = document.createElement('section');
  box.className = 'fatal-error';
  const title = document.createElement('h1');
  title.textContent = '計算機啟動失敗。';
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '重新嘗試';
  retry.addEventListener('click', () => window.location.reload());
  box.append(title, message, retry);
  root.append(box);
});
