import { useState } from 'react';
import { MainScreen } from './main-screen/MainScreen';
import { SettingsPanel } from './settings/SettingsPanel';

export function App() {
  const [view, setView] = useState<'main' | 'settings'>('main');

  if (view === 'settings') {
    return <SettingsPanel onDone={() => setView('main')} />;
  }

  return <MainScreen onOpenSettings={() => setView('settings')} />;
}
