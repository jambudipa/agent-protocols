/**
 * Test support of the v0.3 compatibility tests.
 */
import { duplicateInterfacesForLegacy } from '../src/compat/v0_3/index.js';
import type { AgentCard } from '../src/index.js';
import { echoCard } from './support.js';

/** The echo card with a v0.3 copy of each interface. */
export const legacyCard = (baseUrl: string): AgentCard => {
  const card = echoCard(baseUrl);
  return {
    ...card,
    supportedInterfaces: duplicateInterfacesForLegacy(
      card.supportedInterfaces,
      ['JSONRPC', 'HTTP+JSON']
    ),
  };
};
