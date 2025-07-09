"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { getCurrentUser, changeUserPassword } from '@/lib/authService';
import { AppHeader } from '@/components/app/AppHeader';
import { KeyRound, User as UserIcon } from 'lucide-react';

function ProfilePageContent() {
  const { toast } = useToast();
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
      setCurrentUserEmail(user.email);
    }
  }, []);

  const handlePasswordChange = () => {
    if (newPassword.length < 4) {
      toast({ variant: 'destructive', title: 'Error', description: 'Password must be at least 4 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'Error', description: 'Passwords do not match.' });
      return;
    }

    const success = changeUserPassword(currentUserEmail, newPassword);
    if (success) {
      toast({ title: 'Success', description: 'Your password has been changed.' });
      setNewPassword('');
      setConfirmPassword('');
    } else {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to change password.' });
    }
  };

  return (
    <>
      <AppHeader />
      <div className="container mx-auto p-4 md:p-6 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">User Profile</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserIcon /> Your Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={currentUserEmail} readOnly disabled />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound /> Change Password</CardTitle>
            <CardDescription>Enter a new password for your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
            <Button onClick={handlePasswordChange}>Save New Password</Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function ProfilePage() {
    return (
        <AuthGuard>
            <ProfilePageContent />
        </AuthGuard>
    )
}
