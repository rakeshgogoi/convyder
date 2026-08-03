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
    const saved = JSON.parse(raw);
    // A plain top-level spread would silently drop new fields added to
    // `incoming`/`outgoing` (e.g. voiceGender) for anyone with a config
    // saved before that field existed — the saved nested object would
    // fully replace the default rather than fill in the gap.
    return {
      ...DEFAULT_APP_CONFIG,
      ...saved,
      incoming: { ...DEFAULT_APP_CONFIG.incoming, ...saved.incoming },
      outgoing: { ...DEFAULT_APP_CONFIG.outgoing, ...saved.outgoing },
    };
  } catch {
    return DEFAULT_APP_CONFIG;
  }
}

export function writeConfig(config: AppConfig): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}
