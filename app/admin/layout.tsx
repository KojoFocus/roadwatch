export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh" }}>
      {children}
    </div>
  );
}
