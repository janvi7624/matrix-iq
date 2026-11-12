import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { addProductManagerNote, getProductManagerRollup, listMyProducts, listProductManagerNotes } from '@/lib/productManagerStore';
import { apiErrorResponse } from '@/lib/apiError';

// Every logged-in user's own Product Manager view: the products THEY
// created, the Pending/Won/Lost rollup those products have earned across
// every quotation, and their own feedback/action/plan timeline. Someone
// who has never created a product simply gets an empty rollup — there is
// no separate "am I a Product Manager" role; ownership is just
// Product.createdBy (see lib/productManagerStore.ts).
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [rollup, products, notes] = await Promise.all([
      getProductManagerRollup(user.id),
      listMyProducts(user.id),
      listProductManagerNotes(user.id)
    ]);
    return NextResponse.json({ rollup, products, notes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const NOTE_TYPES = new Set(['feedback', 'action', 'plan']);

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const type = body?.type;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!NOTE_TYPES.has(type) || !text) {
    return NextResponse.json({ error: 'A note type (feedback/action/plan) and non-empty text are required' }, { status: 400 });
  }

  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const note = await addProductManagerNote(user.id, type, text.slice(0, 4000), user.id);
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
