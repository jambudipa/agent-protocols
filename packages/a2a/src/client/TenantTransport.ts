/**
 * A transport that fills in the tenant of the agent interface.
 *
 * @since 0.1.0
 */
import type { Transport } from './Transport.js';

/**
 * Fills `tenant` with `defaultTenant` when it is absent or empty. An empty
 * string counts as no tenant, so it never overrides the interface's tenant.
 */
const withTenant =
  (defaultTenant: string) =>
  <P extends { readonly tenant?: string }>(params: P): P => ({
    ...params,
    tenant:
      params.tenant === undefined || params.tenant === ''
        ? defaultTenant
        : params.tenant,
  });

/**
 * Wraps a transport so that every request without a tenant carries
 * `defaultTenant`, the `tenant` of the selected agent interface.
 *
 * @since 0.1.0
 */
export const TenantTransportDecorator = (
  base: Transport,
  defaultTenant: string
): Transport => {
  const tenant = withTenant(defaultTenant);
  return {
    protocolName: base.protocolName,
    protocolVersion: base.protocolVersion,
    getExtendedAgentCard: (params, options) =>
      base.getExtendedAgentCard(tenant(params), options),
    sendMessage: (params, options) => base.sendMessage(tenant(params), options),
    sendMessageStream: (params, options) =>
      base.sendMessageStream(tenant(params), options),
    getTask: (params, options) => base.getTask(tenant(params), options),
    cancelTask: (params, options) => base.cancelTask(tenant(params), options),
    listTasks: (params, options) => base.listTasks(tenant(params), options),
    createTaskPushNotificationConfig: (params, options) =>
      base.createTaskPushNotificationConfig(tenant(params), options),
    getTaskPushNotificationConfig: (params, options) =>
      base.getTaskPushNotificationConfig(tenant(params), options),
    listTaskPushNotificationConfig: (params, options) =>
      base.listTaskPushNotificationConfig(tenant(params), options),
    deleteTaskPushNotificationConfig: (params, options) =>
      base.deleteTaskPushNotificationConfig(tenant(params), options),
    resubscribeTask: (params, options) =>
      base.resubscribeTask(tenant(params), options),
  };
};
