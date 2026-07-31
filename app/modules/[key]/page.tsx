import CustomModuleView from '@/components/CustomModuleView';

export default async function CustomModulePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <CustomModuleView moduleKey={key} />;
}
