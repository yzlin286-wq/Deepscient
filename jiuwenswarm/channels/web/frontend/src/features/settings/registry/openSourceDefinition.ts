import { createSettingsPageDefinition } from './createSettingsPageDefinition';
import { openSourceSettingsAccessPolicy } from './accessPolicy';
import { generalModule } from '../modules/general';
import { modelsModule } from '../modules/models';
import { billingModule } from '../modules/billing';
import { agentModule } from '../modules/agent';
import { browserModule } from '../modules/browser';
import { channelsModule } from '../modules/channels';
import { personalContextSettingsModule } from '../modules/personalContext';
import { archivedTasksModule } from '../modules/archivedTasks';
import { experimentalModule } from '../modules/experimental';

export const openSourceSettingsPageDefinition = createSettingsPageDefinition({
  id: 'open-source-settings',
  compositionMode: 'base',
  accessPolicy: openSourceSettingsAccessPolicy,
  modules: [
    generalModule,
    modelsModule,
    billingModule,
    agentModule,
    browserModule,
    channelsModule,
    personalContextSettingsModule,
    archivedTasksModule,
    experimentalModule,
  ],
});

export const settingsPageDefinition = openSourceSettingsPageDefinition;
