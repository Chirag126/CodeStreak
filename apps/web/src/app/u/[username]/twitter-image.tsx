import { OG_SIZE, widgetImage } from '@/lib/widget/card';
import { loadWidget } from '@/lib/widget/load';

// Phase 38: the dynamic social image for /u/<username> on X (same card as the Open Graph image).
// Unknown or hidden profiles get the "Profile not found" card.
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'CodeStreak profile card';
export const dynamic = 'force-dynamic';

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { model } = await loadWidget((await params).username);
  return widgetImage(model, 'dark', OG_SIZE);
}
