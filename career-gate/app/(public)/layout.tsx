export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <header className="mb-6">
        <p className="text-lg font-semibold text-brand-700">Career Gate</p>
      </header>
      {children}
    </div>
  );
}
