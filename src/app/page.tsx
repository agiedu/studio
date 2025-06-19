
import { redirect } from 'next/navigation';

export default function Home() {
  // Redirect to the library page by default
  redirect('/library');

  // Fallback content if redirect doesn't happen immediately (should not be visible)
  // return (
  //   // <div className="flex flex-col flex-grow items-center justify-center">
  //   //   <p>Redirecting to your library...</p>
  //   // </div>
  // );
}
