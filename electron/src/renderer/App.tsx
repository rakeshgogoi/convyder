import { useEffect, useState } from 'react';
import { MainScreen } from './main-screen/MainScreen';
import { SettingsPanel } from './settings/SettingsPanel';
import { SetupScreen } from './setup/SetupScreen';

type View = 'loading' | 'setup' | 'main' | 'settings';

export function App() {
  const [view, setView] = useState<View>('loading');

  useEffect(() => {
    window.convyder.setup.check().then((isSetUp) => setView(isSetUp ? 'main' : 'setup'));
  }, []);

  if (view === 'loading') return null;
  if (view === 'setup') return <SetupScreen onComplete={() => setView('main')} />;
  if (view === 'settings') return <SettingsPanel onDone={() => setView('main')} />;
  return <MainScreen onOpenSettings={() => setView('settings')} />;
}
