export type { ResolvedWebConfig, WebConfig } from './config.js';
export { DEFAULT_WEB_ROOT, resolveWebConfig, WebConfigError } from './config.js';
export type { WebHost, WebHostOptions } from './host.js';
export { createWebHost, injectPublicConfig, PUBLIC_CONFIG_ELEMENT, serializePublicConfig } from './host.js';
export type { RouteCollision } from './routes.js';
export { describeCollisions, findRouteCollisions, isReservedPath, RESERVED_NAMESPACES } from './routes.js';
