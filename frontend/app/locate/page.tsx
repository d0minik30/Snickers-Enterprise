import type { Metadata } from 'next';
import LocateScreen from '@/components/locate/LocateScreen';

export const metadata: Metadata = {
  title: 'Locate · Marsfinder',
};

export default function LocatePage() {
  return <LocateScreen />;
}
