import { Link } from 'react-router-dom';
import { HOME_OF, useAuth } from '../../lib/auth';

export default function NotFound() {
  const { user } = useAuth();
  return (
    <div className="grid min-h-full place-items-center p-6 text-center">
      <div>
        <p className="font-display text-5xl font-semibold text-forest">404</p>
        <p className="mt-2 text-ink-muted">This page does not exist.</p>
        <Link to={user ? HOME_OF[user.role] : '/login'} className="mt-4 inline-block font-semibold text-forest-700 underline">Go to home</Link>
      </div>
    </div>
  );
}
