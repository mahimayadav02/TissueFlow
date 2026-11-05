import { Construction } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Card, PageHeader } from '../../components/ui';
import { allItems } from '../../config/nav';
import { useAuth } from '../../lib/auth';

/** Placeholder for pages that are planned but not built yet. */
export default function ComingSoon() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const item = user ? allItems(user.role).find((i) => i.path === pathname) : undefined;

  return (
    <>
      <PageHeader title={item?.label ?? 'Page'} subtitle="This page is planned and will be added in a later step." />
      <Card>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <Construction size={22} className="text-amberx-700" />
          <span>Coming in <b className="text-ink">Phase {item?.phase ?? '–'}</b> of the frontend plan.</span>
        </div>
      </Card>
    </>
  );
}
