import { useEffect, useState } from "react";

export function useHistoryYear(month: string, months: string[]) {
  const referenceYear = month.slice(0, 4);
  const [year, setYear] = useState(referenceYear);
  useEffect(() => {
    setYear(current => current === "all" ? current : referenceYear);
  }, [referenceYear]);
  const years = [...new Set([
    referenceYear,
    ...(year === "all" ? [] : [year]),
    ...months.map(value => value.slice(0, 4)),
  ])].sort().reverse();
  return { year, setYear, years };
}
