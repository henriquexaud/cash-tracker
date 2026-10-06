import lightMark from "../assets/brand/wallet-light.png";
import darkMark from "../assets/brand/wallet-dark.png";
import { useTheme } from "../theme";

export function BrandMark() {
  const { resolvedTheme } = useTheme();
  return (
    <span className="brand-mark" aria-hidden="true">
      <img
        src={resolvedTheme === "dark" ? darkMark : lightMark}
        alt=""
        width={32}
        height={32}
      />
    </span>
  );
}
