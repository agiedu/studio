"use client";

import { useState, useEffect, useContext } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { changeUserPassword, restoreSession } from '@/lib/authService';
import { KeyRound, User as UserIcon } from 'lucide-react';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

function ProfilePageContent() {
  const { toast } = useToast();
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const profileDict = dictionary.profile;

  useEffect(() => {
    restoreSession().then((user) => { if (user) setCurrentUserEmail(user.email); });
  }, []);

  const handlePasswordChange = async () => {
    if (newPassword.length < 4) {
      toast({ variant: 'destructive', title: commonDict.error, description: dictionary.register.passwordLengthError });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: commonDict.error, description: profileDict.passwordsMismatch });
      return;
    }

    const success = await changeUserPassword(newPassword);
    if (success) {
      toast({ title: commonDict.success, description: profileDict.passwordUpdated });
      setNewPassword('');
      setConfirmPassword('');
    } else {
      toast({ variant: 'destructive', title: commonDict.error, description: profileDict.passwordUpdateFailed });
    }
  };

  return (
    <>
      <div className="container mx-auto p-4 md:p-6 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">{profileDict.title}</h1>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserIcon />{profileDict.yourInformation}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>{commonDict.email}</Label>
              <Input value={currentUserEmail} readOnly disabled />
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound />{profileDict.changePassword}</CardTitle>
            <CardDescription>{profileDict.changePasswordDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">{commonDict.newPassword}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={commonDict.newPassword}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{commonDict.confirmNewPassword}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={commonDict.confirmNewPassword}
              />
            </div>
            <Button onClick={handlePasswordChange}>{profileDict.saveNewPassword}</Button>
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
