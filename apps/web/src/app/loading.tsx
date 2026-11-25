import { PageSkeleton } from '@/components/feedback/page-skeleton';

// Shown while any page's server data loads (each route keeps its own empty and error states).
export default function Loading() {
  return <PageSkeleton />;
}
