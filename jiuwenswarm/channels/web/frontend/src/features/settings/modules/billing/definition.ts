import { settingsNavigationIcons } from '../../../../assets/settings';
import type { SettingsModuleDefinition } from '../../registry/types';
import { PartnerSettings } from './PartnerSettings';

/**
 * 「计费」模块：ccagent 中转站的套餐购买、额度与订单。
 * 未配置 secret 时面板只说明「未配置」，不显示错误样式。
 */
export const billingModule: SettingsModuleDefinition = {
  id: 'billing',
  titleKey: 'settingsPanel.billing.title',
  icon: settingsNavigationIcons.billing,
  source: 'config',
  sections: [
    {
      id: 'billing',
      separatedRows: true,
      items: [{ id: 'billing-partner', component: 'custom', render: PartnerSettings }],
    },
  ],
};
