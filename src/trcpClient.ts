import { createTRPCProxyClient } from '@trpc/client';
// eslint-disable-next-line import/no-unresolved
import { ipcLink } from 'electron-trpc/renderer';
import type {  trcpRouter } from './trcpRouter';
import superjson from 'superjson';


const ipcLinkInstance = ipcLink();
export const client = createTRPCProxyClient<typeof trcpRouter>({
  links: [ipcLinkInstance],
  transformer: superjson,
});