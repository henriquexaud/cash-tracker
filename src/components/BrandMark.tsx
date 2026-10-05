import logoMark from "../assets/logo-mark.svg";

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <img src={logoMark} alt="" width={20} height={20} />
    </span>
  );
}
