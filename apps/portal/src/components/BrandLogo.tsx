import Image from "next/image";
import Link from "next/link";

type BrandLogoProps = {
  href?: string | null;
  size?: "nav" | "hero" | "mark";
  priority?: boolean;
};

const SIZES = {
  nav: { width: 286, height: 140, className: "brand-logo brand-logo-nav" },
  mark: { width: 260, height: 127, className: "brand-logo brand-logo-mark" },
  hero: { width: 546, height: 266, className: "brand-logo brand-logo-hero" },
} as const;

export function BrandLogo({
  href = "/jobs",
  size = "nav",
  priority = false,
}: BrandLogoProps) {
  const s = SIZES[size];
  const img = (
    <Image
      src="/tah-logo.png"
      alt="TakeAwayHero"
      width={s.width}
      height={s.height}
      className={s.className}
      priority={priority}
    />
  );

  if (href == null) {
    return <span className="brand-logo-wrap">{img}</span>;
  }

  return (
    <Link href={href} className="brand-logo-wrap" aria-label="TakeAwayHero home">
      {img}
    </Link>
  );
}
