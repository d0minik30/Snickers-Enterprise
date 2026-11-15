import type { Metadata } from 'next';
import JezeroScreen from '@/components/jezero/JezeroScreen';

export const metadata: Metadata = {
  title: 'Jezero · Marsfinder',
};

export default function MapPage() {
  return <JezeroScreen />;
}
