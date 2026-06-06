import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { forwardRef } from 'react';
import { toAppPath, toRouterPath } from '../lib/path-map';
import { router } from '../router';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  children?: ReactNode;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, onClick, replace = false, children, ...props },
  ref,
) {
  const appHref = toAppPath(href);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    if (props.target && props.target !== '_self') return;

    const target = toRouterPath(appHref);
    if (!target) return;

    event.preventDefault();
    void router.navigate({
      to: target.to as never,
      search: target.search as never,
      replace,
    });
  };

  return (
    <a {...props} ref={ref} href={appHref} onClick={handleClick}>
      {children}
    </a>
  );
});

export default Link;
