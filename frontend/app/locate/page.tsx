import type { Metadata } from 'next';
import LocateScreen from '@/components/locate/LocateScreen';

export const metadata: Metadata = {
  title: 'Locate · Mars Map',
};

export default function LocatePage() {
  return <LocateScreen />;
}
