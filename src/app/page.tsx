import { MangaRoom } from "@/components/app/MangaRoom";

export default function Home() {
  return (
    <div className="flex flex-col flex-grow">
        <MangaRoom />
      <footer className="py-6 text-center text-sm text-muted-foreground border-t mt-auto">
        <p>&copy; {new Date().getFullYear()} MangaTalk. All rights reserved (not really).</p>
        <p>Crafted with AI for your reading pleasure.</p>
      </footer>
    </div>
  );
}
