import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center text-center flex-1 gap-3">
      <h1 className="text-3xl font-bold">effx</h1>
      <p>An AOT compiler for Effect v4. Decorators and builders in, ordinary Effect out.</p>
      <p>
        <Link href="/docs" className="font-medium underline">
          Read the documentation
        </Link>
      </p>
    </div>
  );
}
