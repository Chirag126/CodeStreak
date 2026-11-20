import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StyleGuide } from './style-guide';

export const metadata: Metadata = {
  title: 'Style guide',
  robots: { index: false, follow: false },
};

// Never prerendered; the route returns 404 in production builds.
export const dynamic = 'force-dynamic';

export default function StyleGuidePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <StyleGuide />;
}
