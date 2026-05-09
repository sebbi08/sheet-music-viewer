import { createTRPCProxyClient } from '@trpc/client';
// eslint-disable-next-line import/no-unresolved
import superjson from 'superjson';
import { ipcLink } from 'trpc-electron/renderer';
import type { trcpRouter } from './trcpRouter';


const ipcLinkInstance = ipcLink();
export const client = createTRPCProxyClient<typeof trcpRouter>({
  links: [ipcLinkInstance],
  transformer: superjson,
});
