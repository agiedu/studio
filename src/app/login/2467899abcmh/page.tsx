"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { loginUser } from '@/lib/authService';
import { MangaTalkLogo } from '@/components/icons/MangaTalkLogo';
import { AlertCircle } from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  const handleLogin = () => {
    setError('');

    if (parseInt(captchaAnswer, 10) !== num1 + num2) {
        setError('Incorrect verification answer. Please try again.');
        generateCaptcha();
        return;
    }

    const result = loginUser(email, password);
    if (result.success) {
      toast({ title: 'Login Successful', description: 'Redirecting to admin panel...' });
      router.push('/admin/management');
    } else {
      setError(result.message);
      toast({ variant: 'destructive', title: 'Login Failed', description: result.message });
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
          <CardTitle>Admin Login</CardTitle>
          <CardDescription>Enter admin credentials to access the management panel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Admin Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@example.com"
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
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
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
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertCircle className="h-4 w-4" />{error}</p>}
          <Button onClick={handleLogin} className="w-full">
            Login
          </Button>
          <p className="text-xs text-muted-foreground text-center pt-2">
            Note: The default admin password is 'admin'.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
