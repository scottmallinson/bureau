import { useEffect, useState, type MouseEvent } from 'react';
import { DISPATCH_RELEASES_URL, dispatchComposeLink } from '../../core/dispatch.js';
import { desktop } from '../desktop.js';
import { formatDateTime } from '../format.js';

/**
 * The menu a click on an empty calendar cell opens. Its one action hands the
 * cell's time to Dispatch.
 *
 * The desktop app asks the operating system whether Dispatch is installed, so
 * it shows only the action or only the download link. A browser cannot see
 * installed apps, so it shows the action and says where to get Dispatch in case
 * nothing opens.
 */
export function CellMenu({ at }: { at: Date }) {
  const link = dispatchComposeLink(at);
  const [installed, setInstalled] = useState<boolean>();

  useEffect(() => {
    if (!desktop) return;
    void desktop.dispatchInstalled().then(setInstalled, () => setInstalled(false));
  }, []);

  // Inside the desktop app the link goes through the main process, which is the
  // only place allowed to hand a link to another app.
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!desktop) return;
    event.preventDefault();
    void desktop.openDispatch(link).catch(() => undefined);
  };

  const showAction = !desktop || installed === true;
  const showDownload = !desktop || installed === false;

  return (
    <div
      className="cell-menu"
      role="group"
      aria-label={`New post at ${formatDateTime(at.toISOString())}`}
    >
      <p className="cell-menu-when">{formatDateTime(at.toISOString())}</p>
      {showAction && (
        <a className="cell-menu-action" href={link} onClick={open}>
          New post in Dispatch
        </a>
      )}
      {showDownload && (
        <p className="cell-menu-hint">
          {desktop
            ? 'Dispatch is not installed.'
            : 'Nothing opened? Dispatch may not be installed.'}{' '}
          <a href={DISPATCH_RELEASES_URL} target="_blank" rel="noreferrer">
            Get Dispatch
          </a>
        </p>
      )}
    </div>
  );
}
