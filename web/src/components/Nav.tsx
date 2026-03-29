import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/sessions", label: "Sessions" },
  { href: "/telemetry", label: "Telemetry" },
  { href: "/chat", label: "Analyst" },
  { href: "/catalog", label: "Catalog" }
];

export function Nav() {
  return (
    <header className="top-nav">
      <div className="brand">OpenF1 Explorer</div>
      <nav aria-label="Primary">
        <ul className="link-list">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
