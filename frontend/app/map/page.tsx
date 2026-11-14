import type { Metadata } from 'next';
import JezeroScreen from '@/components/jezero/JezeroScreen';

export const metadata: Metadata = {
  title: 'Jezero · Mars Map',
};

export default function MapPage() {
  return <JezeroScreen />;
}
