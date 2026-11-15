import type { Metadata } from 'next';
import PointCloudScreen from '@/components/pointcloud/PointCloudScreen';

export const metadata: Metadata = {
  title: 'Point cloud · Marsfinder',
};

export default function PointCloudPage() {
  return <PointCloudScreen />;
}
