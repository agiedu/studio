"use client";

import { useState, useEffect, useContext } from 'react';
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
import { Trash2, Users, KeyRound, AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

function AdminManagementPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<Omit<User, 'passwordHash'>[]>([]);
  const [userToDelete, setUserToDelete] = useState<{email: string} | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [adminLoginUrl, setAdminLoginUrl] = useState('');

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const adminDict = dictionary.admin;

  useEffect(() => {
    setUsers(getAllUsersForAdmin());
    setAdminLoginUrl(getAdminLoginUrl());
  }, []);

  const performDelete = async () => {
    if (!userToDelete) return;
    
    const result = await deleteUserByAdmin(userToDelete.email);
    
    if (result.success) {
      toast({ title: adminDict.userDeleted, description: adminDict.userDeletedMessage.replace('{email}', userToDelete.email) });
      setUsers(getAllUsersForAdmin()); // Refetch the list from the source
    } else {
      toast({ 
        variant: 'destructive', 
        title: adminDict.errorDeletingUser, 
        description: result.message || 'An unknown error occurred. Check the console for details.' 
      });
    }
    setUserToDelete(null); // Close the dialog
  };

  const handlePasswordChange = () => {
    if (newAdminPassword.length < 4) {
      toast({ variant: 'destructive', title: commonDict.error, description: dictionary.register.passwordLengthError });
      return;
    }
    const adminUser = getCurrentUser();
    if (!adminUser) {
        toast({ variant: 'destructive', title: commonDict.error, description: 'Could not identify admin user.' });
        return;
    }

    const success = changeUserPassword(adminUser.email, newAdminPassword);
    if (success) {
      toast({ title: commonDict.success, description: adminDict.adminPasswordUpdated });
      setNewAdminPassword('');
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: adminDict.failedToUpdateAdminPassword });
    }
  };

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-bold">{adminDict.title}</h1>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users />{adminDict.userManagement}</CardTitle>
            <CardDescription>{adminDict.userManagementDescription}</CardDescription>
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
                        onClick={() => setUserToDelete(user)}
                        aria-label={`Delete user ${user.email}`}
                    >
                        <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                    </li>
                ))}
                </ul>
            ) : (
                <p className="text-muted-foreground">{adminDict.noOtherUsers}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound />{adminDict.adminSettings}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="admin-password">{adminDict.changeAdminPassword}</Label>
              <Input
                id="admin-password"
                type="password"
                value={newAdminPassword}
                onChange={e => setNewAdminPassword(e.target.value)}
                placeholder={adminDict.newAdminPasswordPlaceholder}
              />
              <Button onClick={handlePasswordChange} className="mt-2">{adminDict.savePassword}</Button>
            </div>
            <div>
              <Label htmlFor="admin-url">{adminDict.adminLoginURL}</Label>
              <Input
                id="admin-url"
                type="text"
                value={adminLoginUrl}
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> {adminDict.urlNotChangeable}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <AlertDialog open={!!userToDelete} onOpenChange={(isOpen) => !isOpen && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{commonDict.areYouSure}</AlertDialogTitle>
            <AlertDialogDescription>
              {commonDict.actionCannotBeUndone} {adminDict.deleteUserConfirmation.replace('{email}', userToDelete?.email || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonDict.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete}>{commonDict.continue}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
