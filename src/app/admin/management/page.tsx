"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AdminAuthGuard } from '@/components/auth/AuthGuard';
import {
  getAllUsersForAdmin,
  deleteUserByAdmin,
  getAdminLoginUrl,
  changeUserPassword,
  getCurrentUser
} from '@/lib/authService';
import type { User } from '@/types';
import { Trash2, Users, KeyRound, Link as LinkIcon, AlertTriangle } from 'lucide-react';
import { AppHeader } from '@/components/app/AppHeader';


function AdminManagementPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<Omit<User, 'passwordHash'>[]>([]);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [adminLoginUrl, setAdminLoginUrl] = useState('');

  useEffect(() => {
    setUsers(getAllUsersForAdmin());
    setAdminLoginUrl(getAdminLoginUrl());
  }, []);

  const handleDeleteUser = (email: string) => {
    if (confirm(`Are you sure you want to delete user ${email}? This cannot be undone.`)) {
      const success = deleteUserByAdmin(email);
      if (success) {
        // Re-fetch the user list from the source of truth to ensure UI consistency
        setUsers(getAllUsersForAdmin());
        toast({ title: 'User Deleted', description: `User ${email} has been removed.` });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete user.' });
      }
    }
  };

  const handlePasswordChange = () => {
    if (newAdminPassword.length < 4) {
      toast({ variant: 'destructive', title: 'Error', description: 'Password must be at least 4 characters long.' });
      return;
    }
    const adminUser = getCurrentUser();
    if (!adminUser) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not identify admin user.' });
        return;
    }

    const success = changeUserPassword(adminUser.email, newAdminPassword);
    if (success) {
      toast({ title: 'Success', description: 'Admin password updated successfully.' });
      setNewAdminPassword('');
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to update password.' });
    }
  };

  return (
    <>
      <AppHeader />
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">Admin Management Panel</h1>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users /> User Management</CardTitle>
            <CardDescription>View and manage all registered users.</CardDescription>
          </CardHeader>
          <CardContent>
            {users.length > 0 ? (
                <ul className="space-y-2">
                {users.map(user => (
                    <li key={user.email} className="flex items-center justify-between p-2 border rounded-md">
                    <span>{user.email}</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteUser(user.email)}
                        aria-label={`Delete user ${user.email}`}
                    >
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                    </li>
                ))}
                </ul>
            ) : (
                <p className="text-muted-foreground">No other users have registered.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound /> Admin Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="admin-password">Change Admin Password</Label>
              <Input
                id="admin-password"
                type="password"
                value={newAdminPassword}
                onChange={e => setNewAdminPassword(e.target.value)}
                placeholder="New admin password"
              />
              <Button onClick={handlePasswordChange} className="mt-2">Save Password</Button>
            </div>
            <div>
              <Label htmlFor="admin-url">Admin Login URL</Label>
              <Input
                id="admin-url"
                type="text"
                value={adminLoginUrl}
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> This cannot be changed in a client-only application.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function AdminManagementPageWrapper() {
  return (
    <AdminAuthGuard>
      <AdminManagementPage />
    </AdminAuthGuard>
  );
}
