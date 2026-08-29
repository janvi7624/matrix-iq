import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { toCsv } from '@/lib/csv';

const HEADERS = ['Name', 'Company', 'Designation', 'Phone', 'Email', 'Address', 'City', 'Website', 'Source', 'Remarks'];
const SAMPLE_ROW = ['Rahul Shah', 'ABC Company', 'Purchase Manager', '9876543210', 'rahul@abccompany.com', '', 'Ahmedabad', '', 'Trade Show', 'Interested in AV solution'];

// A downloadable sample so a Sales user's CSV column-mapping step has a
// concrete starting point instead of guessing which columns are expected.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const csv = toCsv(HEADERS, [SAMPLE_ROW]);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="lead-import-template.csv"'
    }
  });
}
