import { createTRPCProxyClient } from '@trpc/client';
// eslint-disable-next-line import/no-unresolved
import { ipcLink } from 'electron-trpc/renderer';
import superjson from 'superjson';
import type { trcpRouter } from './trcpRouter';


const ipcLinkInstance = ipcLink();
export const client = createTRPCProxyClient<typeof trcpRouter>({
  links: [ipcLinkInstance],
  transformer: superjson,
});