import { createTRPCProxyClient } from "@trpc/client";
import superjson from "superjson";
import { ipcLink } from "trpc-electron/renderer";
import type { trcpRouter } from "./trcpRouter";

const ipcLinkInstance = ipcLink({
  transformer: superjson,
});
export const client = createTRPCProxyClient<typeof trcpRouter>({
  links: [ipcLinkInstance],
});
