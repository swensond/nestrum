import { createApiClient, createAuthClient, readPublicConfig } from '@nestrum/web/client';

export const auth = createAuthClient();
export const api = createApiClient();
export const publicConfig = readPublicConfig();
