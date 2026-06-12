import fs from "node:fs";

const textField = (value = "") => String(value ?? "").trim();

const decodeWith = (bytes, label, offset = 0) => {
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes.subarray(offset));
  } catch {
    return "";
  }
};

const scoreTextQuality = (text = "") => {
  const value = textField(text);
  if (!value) return -100;
  let score = 0;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 0xfffd) score -= 4;
    else if (code === 0) score -= 6;
    else if (/[\u4e00-\u9fff]/.test(char)) score += 3;
    else if (/[A-Za-z0-9，。！？：；、""''（）《》\n\r\t .,:;!?-]/.test(char)) score += 1;
    else if (code >= 32 && code < 127) score += 0.5;
    else if (code < 32 && char !== "\n" && char !== "\r" && char !== "\t") score -= 2;
    else score -= 1;
  }
  return score / Math.max(value.length, 1);
};

export const isGarbledTextContent = (text = "") => {
  const value = textField(text);
  if (!value) return true;
  if (scoreTextQuality(value) < 0.15) return true;
  if ((value.match(/\uFFFD/g) ?? []).length >= 3) return true;
  if (/\0/.test(value)) return true;
  if (/^[\u0080-\u00ff\u0100-\u024f]{8,}$/.test(value.slice(0, 120))) return true;
  return false;
};

export const decodeTextBytes = (input) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) return { text: "", encoding: "empty", garbled: true };

  const candidates = [];
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    candidates.push({ encoding: "utf-8-bom", text: decodeWith(bytes, "utf-8", 3) });
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    candidates.push({ encoding: "utf-16le-bom", text: decodeWith(bytes, "utf-16le", 2) });
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    candidates.push({ encoding: "utf-16be-bom", text: decodeWith(bytes, "utf-16be", 2) });
  }

  candidates.push({ encoding: "utf-8", text: decodeWith(bytes, "utf-8") });
  candidates.push({ encoding: "utf-16le", text: decodeWith(bytes, "utf-16le") });
  for (const label of ["gb18030", "gbk"]) {
    const text = decodeWith(bytes, label);
    if (text) candidates.push({ encoding: label, text });
  }

  const ranked = candidates
    .filter((item) => textField(item.text))
    .sort((left, right) => scoreTextQuality(right.text) - scoreTextQuality(left.text));

  const best = ranked[0] ?? { encoding: "utf-8", text: decodeWith(bytes, "utf-8") };
  return {
    text: best.text,
    encoding: best.encoding,
    garbled: isGarbledTextContent(best.text),
  };
};

export const decodeTextFileSync = (filePath) => decodeTextBytes(fs.readFileSync(filePath));
