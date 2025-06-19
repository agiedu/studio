
import { MangaRoom } from "@/components/app/MangaRoom";
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';


export default function Home() {
  const headersList = headers();
  const fullUrl = headersList.get('x-forwarded-proto') + "://" + headersList.get('host') + headersList.get('x-invoke-path');
  
  // If page.tsx is loaded directly with query params (e.g. from library link), redirect to ensure client components handle it.
  // This typically means the main route '/' was accessed with query params meant for MangaRoom.
  // Or if we decide MangaRoom shouldn't be on the root path, we redirect to a specific path.
  // For now, let's assume MangaRoom is the intended component for the root path.
  // If there's a docId, it means MangaRoom should handle it, which it does via client-side useEffect now.
  // No explicit redirect needed here if MangaRoom correctly picks up query params on client.

  // If you always want MangaRoom to be at a path like /read2 and home to be something else,
  // then you would redirect from here:
  // if (new URL(fullUrl).pathname === '/') {
  //   redirect('/read2' + new URL(fullUrl).search); // or just '/read2' if you don't want to pass params
  // }


  return (
    <div className="flex flex-col flex-grow">
        {/* MangaRoom now handles its own docId loading via useSearchParams on client */}
        <MangaRoom />
      <footer className="py-6 text-center text-sm text-muted-foreground border-t mt-auto">
        <p>&copy; {new Date().getFullYear()} MangaTalk. All rights reserved (not really).</p>
        <p>Crafted with AI for your reading pleasure. Browser storage for documents.</p>
      </footer>
    </div>
  );
}
