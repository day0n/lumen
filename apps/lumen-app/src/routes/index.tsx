import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/')({
  component: IndexRoute,
});

function IndexRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: '/dashboard', replace: true } as never);
  }, [navigate]);

  return null;
}
