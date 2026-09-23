/**
 * One slick, investigated.
 *
 * The surface itself is `investigate/Workspace.tsx`. This file stays as the
 * name the tab strip opens, so `tabs.tsx` keeps one import and the shell never
 * learns how the investigation is put together.
 */

export { Workspace as InvestigateSurface } from './investigate/Workspace';
