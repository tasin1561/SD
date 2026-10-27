import { toCatalogs } from './define';
import { auth } from './messages/auth';
import { authAccept } from './messages/authAccept';
import { authAcceptTeam } from './messages/authAcceptTeam';
import { authReset } from './messages/authReset';
import { authVerify } from './messages/authVerify';
import { authedShell } from './messages/authedShell';
import { common } from './messages/common';
import { consignmentWords } from './messages/consignmentWords';
import { customers } from './messages/customers';
import { dashboard } from './messages/dashboard';
import { freight } from './messages/freight';
import { guidance } from './messages/guidance';
import { holdDecision } from './messages/holdDecision';
import { holds } from './messages/holds';
import { impersonation } from './messages/impersonation';
import { inbound } from './messages/inbound';
import { inboundDetail } from './messages/inboundDetail';
import { inventory } from './messages/inventory';
import { inventoryUnits } from './messages/inventoryUnits';
import { login } from './messages/login';
import { misc } from './messages/misc';
import { needsAttention } from './messages/needsAttention';
import { notificationSettings } from './messages/notificationSettings';
import { notifications } from './messages/notifications';
import { orderConsignee } from './messages/orderConsignee';
import { orderDelivery } from './messages/orderDelivery';
import { orderDetail } from './messages/orderDetail';
import { orderDialogs } from './messages/orderDialogs';
import { orderDispute } from './messages/orderDispute';
import { orderEdit } from './messages/orderEdit';
import { orderImport } from './messages/orderImport';
import { csvColumns } from './messages/csvColumns';
import { orderList } from './messages/orderList';
import { orderNew } from './messages/orderNew';
import { orderPending } from './messages/orderPending';
import { orderPicker } from './messages/orderPicker';
import { orderResellerMoney } from './messages/orderResellerMoney';
import { orderTickets } from './messages/orderTickets';
import { orderUnreachable } from './messages/orderUnreachable';
import { ordersParts } from './messages/ordersParts';
import { packageType } from './messages/packageType';
import { passwordReset } from './messages/passwordReset';
import { productDetail } from './messages/productDetail';
import { productImport } from './messages/productImport';
import { productList } from './messages/productList';
import { productNew } from './messages/productNew';
import { productPicker } from './messages/productPicker';
import { profile } from './messages/profile';
import { quickActions } from './messages/quickActions';
import { resellerForecast } from './messages/resellerForecast';
import { resellerPriceList } from './messages/resellerPriceList';
import { resellerReports } from './messages/resellerReports';
import { resellerRequests } from './messages/resellerRequests';
import { resellerStoreDetail } from './messages/resellerStoreDetail';
import { resellerStores } from './messages/resellerStores';
import { roleWords } from './messages/roleWords';
import { settingsApiKeys } from './messages/settingsApiKeys';
import { settingsHub } from './messages/settingsHub';
import { settingsNotifications } from './messages/settingsNotifications';
import { settingsOrders } from './messages/settingsOrders';
import { settingsSecurity } from './messages/settingsSecurity';
import { settingsStock } from './messages/settingsStock';
import { settingsStores } from './messages/settingsStores';
import { settingsWebhooks } from './messages/settingsWebhooks';
import { shell } from './messages/shell';
import { signUp } from './messages/signUp';
import { team } from './messages/team';
import { teamRoles } from './messages/teamRoles';
import { termsFees } from './messages/termsFees';
import { tickets } from './messages/tickets';
import { tracking } from './messages/tracking';
import { variantDetail } from './messages/variantDetail';
import { wallet } from './messages/wallet';

/**
 * Every namespace, in one place. A namespace is a file of `[en, bn]` pairs;
 * the unit spec asserts no key is defined twice (a spread would silently let
 * the later file win) and that every `{placeholder}` appears in both languages.
 */
export const NAMESPACES = [
  auth,
  authAccept,
  authAcceptTeam,
  authReset,
  authVerify,
  authedShell,
  common,
  consignmentWords,
  customers,
  dashboard,
  freight,
  guidance,
  holdDecision,
  holds,
  impersonation,
  inbound,
  inboundDetail,
  inventory,
  inventoryUnits,
  login,
  misc,
  needsAttention,
  notificationSettings,
  notifications,
  orderConsignee,
  orderDelivery,
  orderDetail,
  orderDialogs,
  orderDispute,
  orderEdit,
  orderImport,
  csvColumns,
  orderList,
  orderNew,
  orderPending,
  orderPicker,
  orderResellerMoney,
  orderTickets,
  orderUnreachable,
  ordersParts,
  packageType,
  passwordReset,
  productDetail,
  productImport,
  productList,
  productNew,
  productPicker,
  profile,
  quickActions,
  resellerForecast,
  resellerPriceList,
  resellerReports,
  resellerRequests,
  resellerStoreDetail,
  resellerStores,
  roleWords,
  settingsApiKeys,
  settingsHub,
  settingsNotifications,
  settingsOrders,
  settingsSecurity,
  settingsStock,
  settingsStores,
  settingsWebhooks,
  shell,
  signUp,
  team,
  teamRoles,
  termsFees,
  tickets,
  tracking,
  variantDetail,
  wallet,
] as const;

const ALL = {
  ...auth,
  ...authAccept,
  ...authAcceptTeam,
  ...authReset,
  ...authVerify,
  ...authedShell,
  ...common,
  ...consignmentWords,
  ...customers,
  ...dashboard,
  ...freight,
  ...guidance,
  ...holdDecision,
  ...holds,
  ...impersonation,
  ...inbound,
  ...inboundDetail,
  ...inventory,
  ...inventoryUnits,
  ...login,
  ...misc,
  ...needsAttention,
  ...notificationSettings,
  ...notifications,
  ...orderConsignee,
  ...orderDelivery,
  ...orderDetail,
  ...orderDialogs,
  ...orderDispute,
  ...orderEdit,
  ...orderImport,
  ...csvColumns,
  ...orderList,
  ...orderNew,
  ...orderPending,
  ...orderPicker,
  ...orderResellerMoney,
  ...orderTickets,
  ...orderUnreachable,
  ...ordersParts,
  ...packageType,
  ...passwordReset,
  ...productDetail,
  ...productImport,
  ...productList,
  ...productNew,
  ...productPicker,
  ...profile,
  ...quickActions,
  ...resellerForecast,
  ...resellerPriceList,
  ...resellerReports,
  ...resellerRequests,
  ...resellerStoreDetail,
  ...resellerStores,
  ...roleWords,
  ...settingsApiKeys,
  ...settingsHub,
  ...settingsNotifications,
  ...settingsOrders,
  ...settingsSecurity,
  ...settingsStock,
  ...settingsStores,
  ...settingsWebhooks,
  ...shell,
  ...signUp,
  ...team,
  ...teamRoles,
  ...termsFees,
  ...tickets,
  ...tracking,
  ...variantDetail,
  ...wallet,
};

export type MessageKey = keyof typeof ALL;

/** `{ en, bn }`, each a flat key → string map. English is the fallback for Bangla. */
export const CATALOGS = toCatalogs<MessageKey>(ALL);
