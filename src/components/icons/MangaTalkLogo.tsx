import type { SVGProps } from 'react';

export function MangaTalkLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="none"
      {...props}
    >
      <rect width="100" height="100" rx="20" fill="hsl(var(--primary))" />
      <path
        d="M30 75V35C30 32.2386 32.2386 30 35 30H65C67.7614 30 70 32.2386 70 35V65C70 67.7614 67.7614 70 65 70H40"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M40 70L30 75"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="42" cy="42" r="5" fill="hsl(var(--primary-foreground))" />
      <path
        d="M55 50H60"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="4"
        strokeLinecap="round"
      />
       <path
        d="M40 58H60"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
