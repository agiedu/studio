import { AppHeader } from "@/components/app/AppHeader";
import { MangaRoom } from "@/components/app/MangaRoom";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <AppHeader />
      <main className="flex-grow">
        <MangaRoom />
      </main>
      <footer className="py-6 text-center text-sm text-muted-foreground border-t">
        <p>&copy; {new Date().getFullYear()} MangaTalk. All rights reserved (not really).</p>
        <p>Crafted with AI for your reading pleasure.</p>
      </footer>
    </div>
  );
}
