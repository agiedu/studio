'use client';
import type { User } from '@/types';
import bcrypt from 'bcryptjs';

const USERS_KEY = 'mangaTalk_users';
const CURRENT_USER_KEY = 'mangaTalk_currentUser';
const ADMIN_SESSION_KEY = 'mangaTalk_adminSession';
const ADMIN_PASSWORD_KEY = 'mangaTalk_adminPassword';
const ADMIN_LOGIN_URL_KEY = 'mangaTalk_adminLoginUrl';

const ADMIN_EMAIL = 'laotouerle@outlook.com';
const DEFAULT_ADMIN_PASSWORD = 'admin';

// Helper to get all users from localStorage
const getUsers = (): User[] => {
  if (typeof window === 'undefined') return [];
  const users = localStorage.getItem(USERS_KEY);
  return users ? JSON.parse(users) : [];
};

// Helper to save all users to localStorage
const saveUsers = (users: User[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

// --- User Functions ---

export const registerUser = (email: string, password: string): { success: boolean; message: string } => {
  const users = getUsers();
  if (users.find(u => u.email === email) || email.toLowerCase() === ADMIN_EMAIL) {
    return { success: false, message: 'User with this email already exists.' };
  }
  const passwordHash = bcrypt.hashSync(password, 8);
  users.push({ email, passwordHash });
  saveUsers(users);
  return { success: true, message: 'User registered successfully.' };
};

export const loginUser = (email: string, password: string): { success: boolean; message: string } => {
  const users = getUsers();
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return { success: false, message: 'Invalid email or password.' };
  }
  // Clear any potential admin session when a regular user logs in.
  localStorage.removeItem(ADMIN_SESSION_KEY);
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ email }));
  return { success: true, message: 'Login successful.' };
};

export const logout = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CURRENT_USER_KEY);
  localStorage.removeItem(ADMIN_SESSION_KEY);
};

export const getCurrentUser = (): { email: string } | null => {
  if (typeof window === 'undefined') return null;
  const user = localStorage.getItem(CURRENT_USER_KEY);
  return user ? JSON.parse(user) : null;
};

export const changeUserPassword = (email: string, newPassword: string): boolean => {
    const users = getUsers();
    const userIndex = users.findIndex(u => u.email === email);
    if (userIndex === -1) {
        return false;
    }
    users[userIndex].passwordHash = bcrypt.hashSync(newPassword, 8);
    saveUsers(users);
    return true;
};

// --- Admin Functions ---

export const loginAdmin = (email: string, password: string): { success: boolean; message: string } => {
  const adminPassword = getAdminPassword();
  if (email.toLowerCase() !== ADMIN_EMAIL || password !== adminPassword) {
    return { success: false, message: 'Invalid admin email or password.' };
  }
  localStorage.setItem(ADMIN_SESSION_KEY, 'true');
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ email }));
  return { success: true, message: 'Admin login successful.' };
};

export const isAdminSessionActive = (): boolean => {
    if (typeof window === 'undefined') return false;
    const session = localStorage.getItem(ADMIN_SESSION_KEY);
    const currentUser = getCurrentUser();
    // Double check: session must be active AND the current user must be the admin
    return session === 'true' && currentUser?.email.toLowerCase() === ADMIN_EMAIL;
};

export const getAllUsersForAdmin = (): Omit<User, 'passwordHash'>[] => {
    if (!isAdminSessionActive()) return [];
    return getUsers().map(({ email }) => ({ email }));
};

export const deleteUserByAdmin = (email: string): boolean => {
    if (!isAdminSessionActive() || email.toLowerCase() === ADMIN_EMAIL) return false;
    let users = getUsers();
    users = users.filter(u => u.email !== email);
    saveUsers(users);
    // In a real app, you would also trigger deletion of the user's IndexedDB,
    // which is complex on their behalf. Here we just delete the login.
    return true;
};


export const getAdminPassword = (): string => {
    if (typeof window === 'undefined') return DEFAULT_ADMIN_PASSWORD;
    return localStorage.getItem(ADMIN_PASSWORD_KEY) || DEFAULT_ADMIN_PASSWORD;
};

export const setAdminPassword = (newPassword: string): boolean => {
    if (!isAdminSessionActive()) return false;
    localStorage.setItem(ADMIN_PASSWORD_KEY, newPassword);
    return true;
};

export const getAdminLoginUrl = (): string => {
    if (typeof window === 'undefined') return '/login/2467899abcmh';
    return localStorage.getItem(ADMIN_LOGIN_URL_KEY) || '/login/2467899abcmh';
};

// Note: This function is a placeholder as we can't change server file routes from the client.
export const setAdminLoginUrl = (newUrl: string): boolean => {
    if (!isAdminSessionActive()) return false;
    // localStorage.setItem(ADMIN_LOGIN_URL_KEY, newUrl);
    console.warn("Changing admin login URL is not supported in this client-only architecture.");
    return false;
};
