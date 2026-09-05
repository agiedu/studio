"use client";

import { useState, useEffect, useContext } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { registerUser } from '@/lib/authService';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { AlertCircle } from 'lucide-react';
import { LanguageContext } from '@/context/LanguageContext';
import { getDictionary } from '@/lib/i18n';

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const { locale } = useContext(LanguageContext);
  const dictionary = getDictionary(locale);
  const commonDict = dictionary.common;
  const loginDict = dictionary.login;
  const registerDict = dictionary.register;

  // Captcha state
  const [num1, setNum1] = useState(0);
  const [num2, setNum2] = useState(0);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const generateCaptcha = () => {
    setNum1(Math.floor(Math.random() * 10));
    setNum2(Math.floor(Math.random() * 10));
    setCaptchaAnswer('');
  };

  useEffect(() => {
    generateCaptcha();
  }, []);

  const handleRegister = async () => {
    setError('');

    if (parseInt(captchaAnswer, 10) !== num1 + num2) {
        setError(loginDict.incorrectAnswer);
        generateCaptcha();
        return;
    }

    if (password !== confirmPassword) {
      setError(registerDict.passwordsDoNotMatch);
      generateCaptcha();
      return;
    }
    if (password.length < 4) {
        setError(registerDict.passwordLengthError);
        generateCaptcha();
        return;
    }

    const result = await registerUser(email, password);
    if (result.success) {
      toast({ title: registerDict.registrationSuccessful, description: registerDict.pleaseLogin });
      router.push('/login');
    } else {
      setError(result.message);
      generateCaptcha();
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40">
        <div className="absolute top-8 flex items-center gap-2">
            <MangaTalkLogo className="h-8 w-8" />
            <h1 className="text-2xl font-bold text-primary">MangaTalk</h1>
        </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{registerDict.title}</CardTitle>
          <CardDescription>{registerDict.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{commonDict.email}</Label>
            <Input
              id="email"
              type="email"
              placeholder="me@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{commonDict.password}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{commonDict.confirmNewPassword}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="captcha">{loginDict.verification.replace('{num1}', String(num1)).replace('{num2}', String(num2))}</Label>
            <Input
              id="captcha"
              type="number"
              placeholder={loginDict.answerPlaceholder}
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
          <Button onClick={handleRegister} className="w-full">
            {registerDict.createAccount}
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            {registerDict.alreadyHaveAccount}{' '}
            <Link href="/login" className="text-primary hover:underline">
              {registerDict.loginLink}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
