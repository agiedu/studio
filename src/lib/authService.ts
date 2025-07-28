import type { User, FailedLoginAttempt } from '@/types';
import bcrypt from 'bcryptjs';
import { deleteDatabaseForUser } from '@/lib/indexedDBService';
import { removeAllDataForUser } from '@/lib/localStorageService';

const USERS_KEY = 'mangaTalk_users';
const CURRENT_USER_KEY = 'mangaTalk_currentUser';
const ADMIN_SESSION_KEY = 'mangaTalk_adminSession';
const FAILED_LOGIN_ATTEMPTS_KEY = 'mangaTalk_failedLoginAttempts';

const ADMIN_EMAIL = 'laotouerle@outlook.com';
const DEFAULT_ADMIN_PASSWORD = 'admin';

// --- Brute-force protection settings ---
const MAX_LOGIN_ATTEMPTS = 3; // Max attempts before locking
const LOCKOUT_PERIOD_MINUTES = 60; // How long to wait for attempts to reset
const LOCKOUT_DURATION_MINUTES = 240; // How long an account is locked

// --- Helper Functions ---

const getUsers = (): User[] => {
  if (typeof window === 'undefined') return [];
  const usersJson = localStorage.getItem(USERS_KEY);
  let users: User[] = usersJson ? JSON.parse(usersJson) : [];

  const adminUserExists = users.some(u => u.email.toLowerCase() === ADMIN_EMAIL);
  if (!adminUserExists) {
    const passwordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 8);
    users.push({ email: ADMIN_EMAIL, passwordHash });
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }
  
  return users;
};

const saveUsers = (users: User[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

const getFailedAttempts = (): Record<string, FailedLoginAttempt> => {
    if (typeof window === 'undefined') return {};
    const attemptsJson = localStorage.getItem(FAILED_LOGIN_ATTEMPTS_KEY);
    return attemptsJson ? JSON.parse(attemptsJson) : {};
};

const saveFailedAttempts = (attempts: Record<string, FailedLoginAttempt>) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(FAILED_LOGIN_ATTEMPTS_KEY, JSON.stringify(attempts));
};


// --- User & Auth Functions ---

export const registerUser = (email: string, password: string): { success: boolean; message: string } => {
  const users = getUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return { success: false, message: 'User with this email already exists.' };
  }
  const passwordHash = bcrypt.hashSync(password, 8);
  users.push({ email, passwordHash });
  saveUsers(users);
  return { success: true, message: 'User registered successfully.' };
};

export const loginUser = (email: string, password: string): { success: boolean; message: string } => {
  const lowerCaseEmail = email.toLowerCase();
  const attempts = getFailedAttempts();
  const userAttempt = attempts[lowerCaseEmail];
  const now = Date.now();

  // 1. Check if the user is currently locked out
  if (userAttempt && userAttempt.lockedUntil && now < userAttempt.lockedUntil) {
      const minutesRemaining = Math.ceil((userAttempt.lockedUntil - now) / (1000 * 60));
      return { success: false, message: `Account is locked. Please try again in ${minutesRemaining} minutes.` };
  }

  // 2. Proceed with login attempt
  const users = getUsers();
  const user = users.find(u => u.email.toLowerCase() === lowerCaseEmail);

  if (!user || !user.passwordHash || !bcrypt.compareSync(password, user.passwordHash)) {
    // 3. Handle failed login attempt
    let newAttemptCount = 1;
    if (userAttempt) {
        // Reset attempts if the last attempt was outside the lockout period window
        const minutesSinceLastAttempt = (now - userAttempt.firstAttemptTimestamp) / (1000 * 60);
        if (minutesSinceLastAttempt > LOCKOUT_PERIOD_MINUTES) {
            newAttemptCount = 1; // Reset counter
        } else {
            newAttemptCount = userAttempt.count + 1;
        }
    }

    if (newAttemptCount >= MAX_LOGIN_ATTEMPTS) {
        // Lock the account
        attempts[lowerCaseEmail] = {
            count: newAttemptCount,
            firstAttemptTimestamp: userAttempt?.firstAttemptTimestamp || now,
            lockedUntil: now + LOCKOUT_DURATION_MINUTES * 60 * 1000,
        };
        saveFailedAttempts(attempts);
        return { success: false, message: `Too many failed attempts. Account has been locked for ${LOCKOUT_DURATION_MINUTES} minutes.` };
    } else {
        // Just record the failed attempt
        attempts[lowerCaseEmail] = {
            count: newAttemptCount,
            firstAttemptTimestamp: newAttemptCount === 1 ? now : userAttempt.firstAttemptTimestamp,
        };
        saveFailedAttempts(attempts);
    }
      
    return { success: false, message: `Invalid email or password. Attempt ${newAttemptCount} of ${MAX_LOGIN_ATTEMPTS}.` };
  }
  
  // 4. Handle successful login
  delete attempts[lowerCaseEmail]; // Clear failed attempts on success
  saveFailedAttempts(attempts);
  
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ email: user.email }));

  if (lowerCaseEmail === ADMIN_EMAIL) {
    localStorage.setItem(ADMIN_SESSION_KEY, 'true');
  } else {
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
    return session === 'true' && !!currentUser && currentUser.email.toLowerCase() === ADMIN_EMAIL;
};

export const getAllUsersForAdmin = (): Omit<User, 'passwordHash'>[] => {
    if (!isAdminSessionActive()) return [];
    return getUsers()
      .filter(u => u.email.toLowerCase() !== ADMIN_EMAIL)
      .map(({ email }) => ({ email }));
};

export const deleteUserByAdmin = async (email: string): Promise<{ success: boolean; message?: string }> => {
    if (!isAdminSessionActive() || email.toLowerCase() === ADMIN_EMAIL) {
        return { success: false, message: "Permission denied." };
    }

    try {
        await deleteDatabaseForUser(email);
        removeAllDataForUser(email);

        let users = getUsers();
        users = users.filter(u => u.email.toLowerCase() !== email.toLowerCase());
        saveUsers(users);
        
        return { success: true };
    } catch (error: any) {
        console.error(`[AuthService] Failed to delete user ${email}:`, error);
        return { success: false, message: error.message };
    }
};

export const getAdminLoginUrl = (): string => {
    if (typeof window === 'undefined') return '/login/2467899abcmh';
    return '/login/2467899abcmh';
};
