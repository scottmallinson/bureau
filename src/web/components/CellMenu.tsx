import type { MouseEvent } from 'react';
import { DISPATCH_RELEASES_URL, dispatchComposeLink } from '../../core/dispatch.js';
import { desktop } from '../desktop.js';
import { formatDateTime } from '../format.js';

/**
 * The menu a click on an empty calendar cell opens. Its one action hands the
 * cell's time to Dispatch. A browser cannot tell whether Dispatch is installed,
 * so the menu always says where to get it in case nothing opens.
 */
export function CellMenu({ at }: { at: Date }) {
  const link = dispatchComposeLink(at);

  // Inside the desktop app the link goes through the main process, which is the
  // only place allowed to hand a link to another app.
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!desktop) return;
    event.preventDefault();
    void desktop.openDispatch(link).catch(() => undefined);
  };

  return (
    <div
      className="cell-menu"
      role="group"
      aria-label={`New post at ${formatDateTime(at.toISOString())}`}
    >
      <p className="cell-menu-when">{formatDateTime(at.toISOString())}</p>
      <a className="cell-menu-action" href={link} onClick={open}>
        New post in Dispatch
      </a>
      <p className="cell-menu-hint">
        Nothing opened? Dispatch may not be installed.{' '}
        <a href={DISPATCH_RELEASES_URL} target="_blank" rel="noreferrer">
          Get Dispatch
        </a>
      </p>
    </div>
  );
}
