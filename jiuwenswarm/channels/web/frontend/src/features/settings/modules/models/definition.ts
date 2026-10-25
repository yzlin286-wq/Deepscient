import { settingsNavigationIcons } from '../../../../assets/settings';
import type { SettingsModuleDefinition } from '../../registry/types';
import { AccountSettings } from './AccountSettings';
import { ModelsSettings } from './ModelsSettings';

export const modelsModule: SettingsModuleDefinition = {
  id: 'models',
  titleKey: 'settingsPanel.categories.models',
  icon: settingsNavigationIcons.models,
  source: 'config',
  sections: [
    {
      id: 'account',
      separatedRows: true,
      items: [{ id: 'account', component: 'custom', render: AccountSettings }],
    },
    {
      id: 'model-manager',
      separatedRows: true,
      items: [{ id: 'model-manager', component: 'custom', render: ModelsSettings }],
    },
  ],
};
