import type {
  AnchorHTMLAttributes,
  FocusEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  TouchEvent,
} from 'react';
import { forwardRef } from 'react';
import { warmAppRouteResources } from '../lib/app-warmup';
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
  {
    href,
    onClick,
    onFocus,
    onMouseDown,
    onPointerEnter,
    onTouchStart,
    replace = false,
    children,
    ...props
  },
  ref,
) {
  const appHref = toAppPath(href);

  const preload = () => {
    preloadLinkTarget(appHref);
  };

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

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    onFocus?.(event);
    if (!event.defaultPrevented) preload();
  };

  const handleMouseDown = (event: MouseEvent<HTMLAnchorElement>) => {
    onMouseDown?.(event);
    if (!event.defaultPrevented) preload();
  };

  const handlePointerEnter = (event: PointerEvent<HTMLAnchorElement>) => {
    onPointerEnter?.(event);
    if (!event.defaultPrevented) preload();
  };

  const handleTouchStart = (event: TouchEvent<HTMLAnchorElement>) => {
    onTouchStart?.(event);
    if (!event.defaultPrevented) preload();
  };

  return (
    <a
      {...props}
      ref={ref}
      href={appHref}
      onClick={handleClick}
      onFocus={handleFocus}
      onMouseDown={handleMouseDown}
      onPointerEnter={handlePointerEnter}
      onTouchStart={handleTouchStart}
    >
      {children}
    </a>
  );
});

function preloadLinkTarget(href: string) {
  const target = toRouterPath(href);
  if (!target) return;

  void router.preloadRoute({
    to: target.to as never,
    search: target.search as never,
  });
  void warmAppRouteResources(href);
}

export default Link;
