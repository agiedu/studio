import { NextRequest, NextResponse } from 'next/server';

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!projectUrl || !serviceRoleKey) return NextResponse.json({ error: 'The server is missing Supabase admin configuration.' }, { status: 503 });
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const viewerResponse = await fetch(`${projectUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: serviceRoleKey } });
  if (!viewerResponse.ok) return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  const viewer = await viewerResponse.json() as { id: string };
  const profileResponse = await fetch(`${projectUrl}/rest/v1/profiles?id=eq.${viewer.id}&select=role`, { headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } });
  const profiles = await profileResponse.json() as Array<{ role: string }>;
  if (!profileResponse.ok || profiles[0]?.role !== 'admin') return NextResponse.json({ error: 'Administrator permission required.' }, { status: 403 });
  const { id } = await params;
  if (id === viewer.id) return NextResponse.json({ error: 'Administrators cannot delete themselves.' }, { status: 400 });
  const deleteResponse = await fetch(`${projectUrl}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey } });
  if (!deleteResponse.ok) return NextResponse.json({ error: 'Supabase could not delete this user.' }, { status: 502 });
  return NextResponse.json({ success: true });
}
