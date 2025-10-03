export function terbilangIDPdf(n: number): string {
  const satuan = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
  ];

  function sebut3(x: number): string {
    let r = "";
    const ratus = Math.floor(x / 100);
    const sisa = x % 100;
    if (ratus > 0) r += ratus === 1 ? "seratus" : satuan[ratus] + " ratus";
    if (sisa > 0) r += (r ? " " : "") + sebut2(sisa);
    return r || "nol";
  }

  function sebut2(x: number): string {
    if (x < 10) return satuan[x] || "nol";
    if (x === 10) return "sepuluh";
    if (x === 11) return "sebelas";
    if (x < 20) return satuan[x - 10] + " belas";
    const puluh = Math.floor(x / 10);
    const sisa = x % 10;
    return satuan[puluh] + " puluh" + (sisa ? " " + satuan[sisa] : "");
  }

  if (!Number.isFinite(n) || n < 0) n = Math.abs(Math.floor(n));
  if (n === 0) return "Nol rupiah";

  const grups = [
    { v: 1_000_000_000_000, s: " triliun" },
    { v: 1_000_000_000, s: " miliar" },
    { v: 1_000_000, s: " juta" },
    { v: 1_000, s: " ribu" },
  ];

  let s = "";
  let x = Math.floor(n);

  for (const g of grups) {
    if (x >= g.v) {
      const k = Math.floor(x / g.v);
      s +=
        (s ? " " : "") + (g.v === 1000 && k === 1 ? "seribu" : sebut3(k) + g.s);
      x %= g.v;
    }
  }
  if (x > 0) s += (s ? " " : "") + sebut3(x);

  s = s.replace(/\s+/g, " ").trim();
  return toTitleCaseID(s) + " rupiah";
}

function toTitleCaseID(text: string): string {
  return text.replace(/\p{L}[\p{L}\p{Mn}\p{Pd}]*/gu, (word) => {
    const first = word.slice(0, 1).toLocaleUpperCase("id-ID");
    const rest = word.slice(1).toLocaleLowerCase("id-ID");
    return first + rest;
  });
}
export function toTitleCaseIDExcel(text: string): string {
  return text.replace(/\p{L}[\p{L}\p{Mn}\p{Pd}]*/gu, (word) => {
    const first = word.slice(0, 1).toLocaleUpperCase("id-ID");
    const rest = word.slice(1).toLocaleLowerCase("id-ID");
    return first + rest;
  });
}

export function terbilangIDExcel(n: number): string {
  const satuan = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
  ];

  function sebut2(x: number): string {
    if (x < 10) return satuan[x] || "nol";
    if (x === 10) return "sepuluh";
    if (x === 11) return "sebelas";
    if (x < 20) return satuan[x - 10] + " belas";
    const puluh = Math.floor(x / 10);
    const sisa = x % 10;
    return satuan[puluh] + " puluh" + (sisa ? " " + satuan[sisa] : "");
  }

  function sebut3(x: number): string {
    let r = "";
    const ratus = Math.floor(x / 100);
    const sisa = x % 100;
    if (ratus > 0) r += ratus === 1 ? "seratus" : satuan[ratus] + " ratus";
    if (sisa > 0) r += (r ? " " : "") + sebut2(sisa);
    return r || "nol";
  }

  if (!Number.isFinite(n) || n < 0) n = Math.abs(Math.floor(n));
  if (n === 0) return "Nol rupiah";

  const grups = [
    { v: 1_000_000_000_000, s: " triliun" },
    { v: 1_000_000_000, s: " miliar" },
    { v: 1_000_000, s: " juta" },
    { v: 1_000, s: " ribu" },
  ];

  let s = "";
  let x = Math.floor(n);

  for (const g of grups) {
    if (x >= g.v) {
      const k = Math.floor(x / g.v);
      s +=
        (s ? " " : "") + (g.v === 1000 && k === 1 ? "seribu" : sebut3(k) + g.s);
      x %= g.v;
    }
  }
  if (x > 0) s += (s ? " " : "") + sebut3(x);

  s = s.replace(/\s+/g, " ").trim();
  return toTitleCaseIDExcel(s) + " rupiah";
}
