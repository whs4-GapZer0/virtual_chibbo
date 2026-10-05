import type { CSSProperties } from "react";
import { companyHue } from "../lib/format";

export function Monogram({ name, slug, large }: { name: string; slug: string; large?: boolean }) {
  return <span className={large ? "monogram monogram-l" : "monogram"} style={{ "--hue": companyHue(slug) } as CSSProperties} aria-hidden="true">{name.slice(0, 1)}</span>;
}
