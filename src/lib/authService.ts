'use client';
import type { User } from '@/types';
import bcrypt from 'bcryptjs';
import { deleteDatabaseForUser } from '@/lib/indexedDBService';
import { removeAllDataForUser } from '@/lib/localStorageService';

const USERS_KEY = 'mangaTalk_users';
const CURRENT_USER_KEY = 'mangaTalk_currentUser';
const ADMIN_SESSION_KEY = 'mangaTalk_adminSession';
const ADMIN_LOGIN_URL_KEY = 'mangaTalk_adminLoginUrl';

const ADMIN_EMAIL = 'laotouerle@outlook.com';
const DEFAULT_ADMIN_PASSWORD = 'admin';

// Helper to get all users from localStorage, and ensure admin exists
const getUsers = (): User[] => {
  if (typeof window === 'undefined') return [];
  const usersJson = localStorage.getItem(USERS_KEY);
  let users: User[] = usersJson ? JSON.parse(usersJson) : [];

  // Ensure the admin user exists in the list. This is a self-healing mechanism.
  const adminUserExists = users.some(u => u.email.toLowerCase() === ADMIN_EMAIL);
  if (!adminUserExists) {
    console.log("Admin user not found, creating with default password.");
    const passwordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 8);
    users.push({ email: ADMIN_EMAIL, passwordHash });
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }
  
  return users;
};

// Helper to save all users to localStorage
const saveUsers = (users: User[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

// --- User Functions ---

export const registerUser = (email: string, password: string): { success: boolean; message: string } => {
  const users = getUsers();
  // Case-insensitive check to prevent duplicates
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return { success: false, message: 'User with this email already exists.' };
  }
  const passwordHash = bcrypt.hashSync(password, 8);
  users.push({ email, passwordHash });
  saveUsers(users);
  return { success: true, message: 'User registered successfully.' };
};

export const loginUser = (email: string, password: string): { success: boolean; message: string } => {
  const users = getUsers();
  const lowerCaseEmail = email.toLowerCase();
  const user = users.find(u => u.email.toLowerCase() === lowerCaseEmail);

  if (!user || !user.passwordHash || !bcrypt.compareSync(password, user.passwordHash)) {
    return { success: false, message: 'Invalid email or password.' };
  }
  
  // Set current user session
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ email: user.email }));

  // Check if the user is an admin and set admin session if they are
  if (lowerCaseEmail === ADMIN_EMAIL) {
    localStorage.setItem(ADMIN_SESSION_KEY, 'true');
  } else {
    // Explicitly clear admin session for non-admin users
    localStorage.removeItem(ADMIN_SESSION_KEY);
  }
  
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
    const userIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (userIndex === -1) {
        return false;
    }
    users[userIndex].passwordHash = bcrypt.hashSync(newPassword, 8);
    saveUsers(users);
    return true;
};

// --- Admin Functions ---

export const isAdminSessionActive = (): boolean => {
    if (typeof window === 'undefined') return false;
    const session = localStorage.getItem(ADMIN_SESSION_KEY);
    const currentUser = getCurrentUser();
    // Double check: session must be active AND the current user must be the admin
    return session === 'true' && !!currentUser && currentUser.email.toLowerCase() === ADMIN_EMAIL;
};

export const getAllUsersForAdmin = (): Omit<User, 'passwordHash'>[] => {
    if (!isAdminSessionActive()) return [];
    // Filter out the admin user from the list shown in the panel
    return getUsers()
      .filter(u => u.email.toLowerCase() !== ADMIN_EMAIL)
      .map(({ email }) => ({ email }));
};

export const deleteUserByAdmin = async (email: string): Promise<{ success: boolean; message?: string }> => {
    if (!isAdminSessionActive() || email.toLowerCase() === ADMIN_EMAIL) {
        return { success: false, message: "Permission denied." };
    }

    try {
        // Delete IndexedDB data
        await deleteDatabaseForUser(email);

        // Delete localStorage data
        removeAllDataForUser(email);

        // Delete user record from the main list
        let users = getUsers();
        users = users.filter(u => u.email.toLowerCase() !== email.toLowerCase());
        saveUsers(users);
        
        return { success: true };
    } catch (error: any) {
        console.error(`[AuthService] Failed to delete user ${email}:`, error);
        return { success: false, message: error.message };
    }
};

// DEPRECATED FUNCTIONS
export const getAdminPassword = (): string => {
    console.warn("getAdminPassword is deprecated and will be removed.");
    return "";
};
export const setAdminPassword = (newPassword: string): boolean => {
    console.warn("setAdminPassword is deprecated. Use changeUserPassword instead.");
    return false;
};
export const loginAdmin = (email: string, password: string): { success: boolean; message: string } => {
    console.warn("loginAdmin is deprecated. Use loginUser instead.");
    return loginUser(email, password);
};


export const getAdminLoginUrl = (): string => {
    if (typeof window === 'undefined') return '/login/2467899abcmh';
    return localStorage.getItem(ADMIN_LOGIN_URL_KEY) || '/login/2467899abcmh';
};

// Note: This function is a placeholder as we can't change server file routes from the client.
export const setAdminLoginUrl = (newUrl: string): boolean => {
    if (!isAdminSessionActive()) return false;
    console.warn("Changing admin login URL is not supported in this client-only architecture.");
    return false;
};
