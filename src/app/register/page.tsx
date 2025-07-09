"use client";

import { useState, useEffect } from 'react';
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

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

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

  const handleRegister = () => {
    setError('');

    if (parseInt(captchaAnswer, 10) !== num1 + num2) {
        setError('Incorrect verification answer. Please try again.');
        generateCaptcha();
        return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      generateCaptcha();
      return;
    }
    if (password.length < 4) {
        setError('Password must be at least 4 characters long.');
        generateCaptcha();
        return;
    }

    const result = registerUser(email, password);
    if (result.success) {
      toast({ title: 'Registration Successful', description: 'Please log in with your new account.' });
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
          <CardTitle>Register</CardTitle>
          <CardDescription>Create an account to save your library.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
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
            <Label htmlFor="captcha">Verification: What is {num1} + {num2}?</Label>
            <Input
              id="captcha"
              type="number"
              placeholder="Your answer"
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
          <Button onClick={handleRegister} className="w-full">
            Create Account
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline">
              Login
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
