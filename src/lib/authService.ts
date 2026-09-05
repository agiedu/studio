"use client";

import { createClient, type User as SupabaseUser } from '@supabase/supabase-js';
import { logoutAndClearPromises } from '@/lib/indexedDBService';

export type AppRole = 'admin' | 'user';
export type AppUser = { id: string; email: string; role: AppRole };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn('Supabase is not configured. Add the public Supabase URL and publishable key before running the app.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabasePublishableKey || 'placeholder-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

let cachedUser: AppUser | null = null;

async function toAppUser(user: SupabaseUser | null): Promise<AppUser | null> {
  if (!user?.email) return null;
  const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) throw new Error('Unable to load the user profile.');
  return { id: user.id, email: user.email, role: data?.role === 'admin' ? 'admin' : 'user' };
}

export async function restoreSession(): Promise<AppUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) { cachedUser = null; return null; }
  cachedUser = await toAppUser(data.user);
  return cachedUser;
}

export function getCurrentUser(): AppUser | null { return cachedUser; }

export async function registerUser(email: string, password: string): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { success: false, message: error.message };
  if (data.session) cachedUser = await toAppUser(data.user);
  return { success: true, message: data.session ? 'Registration successful.' : 'Registration successful. Please check your email to confirm your account.' };
}

export async function loginUser(email: string, password: string, type: AppRole = 'user'): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { success: false, message: error.message };
  const appUser = await toAppUser(data.user);
  if (!appUser || appUser.role !== type) {
    await supabase.auth.signOut();
    cachedUser = null;
    return { success: false, message: 'This account is not permitted to use this login page.' };
  }
  cachedUser = appUser;
  return { success: true, message: 'Login successful.' };
}

export async function logout(): Promise<void> {
  logoutAndClearPromises();
  cachedUser = null;
  await supabase.auth.signOut();
}

export async function changeUserPassword(newPassword: string): Promise<boolean> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return !error;
}

export function isAdminSessionActive(): boolean { return cachedUser?.role === 'admin'; }

export async function getAllUsersForAdmin(): Promise<AppUser[]> {
  if (!isAdminSessionActive()) return [];
  const { data, error } = await supabase.from('profiles').select('id, email, role').neq('id', cachedUser!.id).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((profile) => ({ id: profile.id, email: profile.email, role: profile.role === 'admin' ? 'admin' : 'user' }));
}

export async function deleteUserByAdmin(userId: string): Promise<{ success: boolean; message?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, message: 'Your session has expired.' };
  const response = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } });
  const body = await response.json().catch(() => ({}));
  return response.ok ? { success: true } : { success: false, message: body.error || 'Unable to delete user.' };
}

export function getAdminLoginUrl(): string { return '/i1lbklewq-6b24678_vvw019-qo0liuuu_w5sc2467-8do1yyvvye7z2nnmai17yt8b13hnhm_o01-ilylcgylbgc99'; }
