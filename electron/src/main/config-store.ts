import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { DEFAULT_APP_CONFIG, type AppConfig } from '@convyder/shared/config-types';

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

export function readConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return { ...DEFAULT_APP_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_APP_CONFIG;
  }
}

export function writeConfig(config: AppConfig): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}
