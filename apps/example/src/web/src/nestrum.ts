import { createApiClient, createAuthClient, createFeatureClient, readPublicConfig } from '@nestrum/web/client';

export const auth = createAuthClient();
export const api = createApiClient();
// Server-evaluated values of the flags declared `exposeToClient: true`; informational, never authorization.
export const features = createFeatureClient();
export const publicConfig = readPublicConfig();
