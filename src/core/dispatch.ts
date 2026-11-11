/**
 * The link that opens Dispatch, the desktop app that publishes posts through
 * Buffer, with its composer set to a time: `dispatch://compose?at=<ISO 8601>`.
 * Bureau cannot tell whether Dispatch is installed, so it only builds the link;
 * the menu that offers it also says where to get Dispatch.
 */

/** Where to get Dispatch when a click on the link does nothing. */
export const DISPATCH_RELEASES_URL = 'https://github.com/scottmallinson/dispatch/releases';

/** The link that opens Dispatch's composer with `at` as the publish time. */
export function dispatchComposeLink(at: Date): string {
  return `dispatch://compose?at=${encodeURIComponent(at.toISOString())}`;
}

const COMPOSE_LINK = /^dispatch:\/\/compose\?at=[^&#\s]+$/;

/** True only for a compose link, so nothing else leaves Bureau's desktop window. */
export function isDispatchComposeLink(link: string): boolean {
  return COMPOSE_LINK.test(link);
}
